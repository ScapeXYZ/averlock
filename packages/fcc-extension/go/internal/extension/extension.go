package extension

import (
	"bytes"
	"context"
	"encoding/gob"
	"encoding/json"
	"fmt"
	"io"
	"math/big"
	"net/http"
	"sync"
	"time"

	"extension-scaffold/internal/config"
	"extension-scaffold/pkg/decision"
	guardtypes "extension-scaffold/pkg/types"

	"github.com/ethereum/go-ethereum/common"
	"github.com/flare-foundation/go-flare-common/pkg/tee/instruction"
	"github.com/flare-foundation/tee-node/pkg/processorutils"
	teetypes "github.com/flare-foundation/tee-node/pkg/types"
	teeutils "github.com/flare-foundation/tee-node/pkg/utils"
)

type Extension struct {
	mu        sync.RWMutex
	Server    *http.Server
	decryptor PolicyDecryptor
	snapshots eventSnapshotReader
	policies  map[common.Hash]*policyState
	store     stateStore

	evaluationCount    int
	successfulTriggers int
}

var snapshotReadyTimeout = 5 * time.Second

// New and actionHandler retain the scaffold framework wiring.
func New(extensionPort, signPort int) *Extension {
	e := newWithDependencies(extensionPort, newTEENodeDecryptor(signPort), newGuardManagerReader())
	e.store = stateStoreFromEnv()
	return e
}

func newWithDecryptor(extensionPort int, decryptor PolicyDecryptor) *Extension {
	return newWithDependencies(extensionPort, decryptor, &staticSnapshotReader{})
}

func newWithDependencies(extensionPort int, decryptor PolicyDecryptor, snapshots eventSnapshotReader) *Extension {
	e := &Extension{decryptor: decryptor, snapshots: snapshots, policies: make(map[common.Hash]*policyState), store: newMemoryStore()}
	mux := http.NewServeMux()
	mux.HandleFunc("GET /state", e.stateHandler)
	mux.HandleFunc("GET /ready", e.readyHandler)
	mux.HandleFunc("POST /action", e.actionHandler)
	e.Server = &http.Server{Addr: fmt.Sprintf(":%d", extensionPort), Handler: mux}
	return e
}

func (e *Extension) readyHandler(w http.ResponseWriter, r *http.Request) {
	ctx, cancel := context.WithTimeout(r.Context(), snapshotReadyTimeout)
	defer cancel()
	if err := e.snapshots.Ready(ctx); err != nil {
		http.Error(w, fmt.Sprintf("snapshot dependency unavailable: %v", err), http.StatusServiceUnavailable)
		return
	}
	w.Header().Set("Content-Type", "application/json")
	_, _ = w.Write([]byte(`{"status":"ready"}`))
}

func (e *Extension) stateHandler(w http.ResponseWriter, _ *http.Request) {
	e.mu.RLock()
	state := guardtypes.StateResponse{
		StateVersion: teeutils.ToHash(config.Version),
		State: guardtypes.State{PolicyCount: len(e.policies), EvaluationCount: e.evaluationCount,
			SuccessfulTriggers: e.successfulTriggers},
	}
	e.mu.RUnlock()
	if err := json.NewEncoder(w).Encode(state); err != nil {
		http.Error(w, fmt.Sprintf("sending response: %v", err), http.StatusInternalServerError)
	}
}

func (e *Extension) processAction(action teetypes.Action) (int, []byte) {
	dataFixed, err := processorutils.Parse[instruction.DataFixed](action.Data.Message)
	if err != nil {
		return http.StatusBadRequest, []byte(fmt.Sprintf("decoding fixed data: %v", err))
	}
	if dataFixed.OPType != teeutils.ToHash(config.OPTypeAverlockGuard) {
		return http.StatusNotImplemented, []byte(fmt.Sprintf("unsupported op type: received %s, expected %s (%s)",
			dataFixed.OPType.Hex(), teeutils.ToHash(config.OPTypeAverlockGuard).Hex(), config.OPTypeAverlockGuard))
	}
	return e.processGuard(action, dataFixed)
}

func (e *Extension) processGuard(action teetypes.Action, df *instruction.DataFixed) (int, []byte) {
	var result teetypes.ActionResult
	switch df.OPCommand {
	case teeutils.ToHash(config.OPCommandCreatePolicy):
		result = e.processCreatePolicy(action, df)
	case teeutils.ToHash(config.OPCommandEvaluateGuard):
		result = e.processEvaluateGuard(action, df)
	default:
		return http.StatusNotImplemented, []byte(fmt.Sprintf("unsupported op command: received %s", df.OPCommand.Hex()))
	}
	body, _ := json.Marshal(result)
	return http.StatusOK, body
}

func (e *Extension) processCreatePolicy(action teetypes.Action, df *instruction.DataFixed) teetypes.ActionResult {
	var request guardtypes.CreatePolicyRequest
	if err := decodeStrictJSON(df.OriginalMessage, &request); err != nil {
		return buildResult(action, df, nil, 0, fmt.Errorf("decoding create policy request: %w", err))
	}
	if len(request.EncryptedPolicy) == 0 {
		return buildResult(action, df, nil, 0, fmt.Errorf("encryptedPolicy must not be empty"))
	}
	plaintext, err := e.decryptor.Decrypt(context.Background(), request.EncryptedPolicy)
	if err != nil {
		return buildResult(action, df, nil, 0, fmt.Errorf("decrypting policy: %w", err))
	}
	var wire guardtypes.Policy
	if err := decodeStrictJSON(plaintext, &wire); err != nil {
		return buildResult(action, df, nil, 0, fmt.Errorf("decoding decrypted policy: %w", err))
	}
	policy, err := normalizePolicy(wire)
	if err != nil {
		return buildResult(action, df, nil, 0, fmt.Errorf("validating policy: %w", err))
	}
	if df.Timestamp > 0 && policy.ExpiresAt <= df.Timestamp {
		return buildResult(action, df, nil, 0, fmt.Errorf("validating policy: expiresAt must be in the future"))
	}
	commitment, err := policyCommitment(policy)
	if err != nil {
		return buildResult(action, df, nil, 0, err)
	}

	e.mu.Lock()
	if _, exists := e.policies[policy.RuleID]; exists {
		e.mu.Unlock()
		return buildResult(action, df, nil, 0, fmt.Errorf("ruleId already exists"))
	}
	state := &policyState{Policy: policy, Commitment: commitment,
		Authorizations: make(map[common.Hash]*eventAuthorization), UsedNonces: make(map[uint64]struct{})}
	if existing, loadErr := e.store.Load(policy.RuleID); loadErr == nil && existing != nil {
		e.mu.Unlock()
		return buildResult(action, df, nil, 0, fmt.Errorf("ruleId already exists"))
	} else if loadErr != nil && loadErr != errStateMissing {
		e.mu.Unlock()
		return buildResult(action, df, nil, 0, fmt.Errorf("loading durable policy state: %w", loadErr))
	}
	if err := e.store.Save(policy.RuleID, state); err != nil {
		e.mu.Unlock()
		return buildResult(action, df, nil, 0, fmt.Errorf("persisting private policy state: %w", err))
	}
	e.policies[policy.RuleID] = state
	e.mu.Unlock()

	response, _ := json.Marshal(guardtypes.CreatePolicyResponse{RuleID: policy.RuleID, Accepted: true, PolicyCommitment: commitment})
	return buildResult(action, df, response, 1, nil)
}

func (e *Extension) processEvaluateGuard(action teetypes.Action, df *instruction.DataFixed) teetypes.ActionResult {
	var request guardtypes.EvaluateGuardRequest
	if err := decodeStrictJSON(df.OriginalMessage, &request); err != nil {
		return buildResult(action, df, nil, 0, fmt.Errorf("decoding evaluate guard request: %w", err))
	}
	if request.RuleID == ([32]byte{}) || request.EventHash == ([32]byte{}) {
		return buildResult(action, df, nil, 0, fmt.Errorf("ruleId and eventHash must not be zero"))
	}
	if df.Timestamp == 0 {
		return buildResult(action, df, nil, 0, fmt.Errorf("trusted instruction timestamp must be non-zero"))
	}

	e.mu.Lock()
	defer e.mu.Unlock()
	state, exists := e.policies[request.RuleID]
	if !exists {
		var loadErr error
		state, loadErr = e.store.Load(request.RuleID)
		if loadErr == nil {
			e.policies[request.RuleID] = state
			exists = true
		} else if loadErr != errStateMissing {
			return buildResult(action, df, nil, 0, fmt.Errorf("loading durable policy state: %w", loadErr))
		}
	}
	if !exists {
		return buildResult(action, df, nil, 0, fmt.Errorf("unknown ruleId"))
	}
	state, cloneErr := clonePolicyState(state)
	if cloneErr != nil {
		return buildResult(action, df, nil, 0, fmt.Errorf("copying private policy state: %w", cloneErr))
	}
	if df.Timestamp > state.Policy.ExpiresAt {
		return buildResult(action, df, nil, 0, fmt.Errorf("policy expired"))
	}
	if _, used := state.UsedNonces[request.Nonce]; used {
		return buildResult(action, df, nil, 0, fmt.Errorf("nonce replay"))
	}
	snapshot, err := e.snapshots.GetSnapshot(context.Background(), request.EventHash)
	if err != nil {
		return buildResult(action, df, nil, 0, fmt.Errorf("reading GuardManager snapshot: %w", err))
	}
	if snapshot.RuleID != request.RuleID {
		return buildResult(action, df, nil, 0, fmt.Errorf("snapshot ruleId mismatch"))
	}
	if snapshot.EventValueUSD18 == nil || snapshot.EventValueUSD18.Sign() <= 0 ||
		snapshot.PriceUSD18 == nil || snapshot.PriceUSD18.Sign() <= 0 || snapshot.PreparedAt == 0 {
		return buildResult(action, df, nil, 0, fmt.Errorf("GuardManager snapshot does not exist"))
	}
	if snapshot.Consumed {
		return buildResult(action, df, nil, 0, fmt.Errorf("event already consumed onchain"))
	}
	eventValue := new(big.Int).Set(snapshot.EventValueUSD18)
	authorization, refreshing := state.Authorizations[request.EventHash]
	if refreshing {
		if eventValue.Cmp(authorization.EventValueUSD18) != 0 {
			return buildResult(action, df, nil, 0, fmt.Errorf("event value mismatch"))
		}
		// GuardManager treats a result as valid through its expiry timestamp, so
		// require the trusted FCC time to be strictly later to prevent overlap.
		if df.Timestamp <= authorization.LastExpiry {
			return buildResult(action, df, nil, 0, fmt.Errorf("authorization still active"))
		}
	}
	triggered := false
	protected := new(big.Int)
	protectBPS := uint16(0)
	scheduleID := uint32(0)
	if refreshing {
		triggered = authorization.Triggered
		protected.Set(authorization.ProtectedUSD18)
		protectBPS = authorization.ProtectBPS
		scheduleID = authorization.ScheduleID
	} else {
		triggered = eventValue.Cmp(state.Policy.ThresholdUSD18) > 0
		if state.Policy.MaxPerEventUSD18.Sign() > 0 && eventValue.Cmp(state.Policy.MaxPerEventUSD18) > 0 {
			triggered = false
		}
		if state.LastTriggered > 0 && df.Timestamp < state.LastTriggered+state.Policy.CooldownSeconds {
			triggered = false
		}
		if triggered {
			protected.Mul(eventValue, new(big.Int).SetUint64(uint64(state.Policy.ProtectBPS)))
			protected.Div(protected, big.NewInt(10_000))
			protectBPS = state.Policy.ProtectBPS
			scheduleID = state.Policy.ScheduleID
			state.LastTriggered = df.Timestamp
		}
		authorization = &eventAuthorization{EventValueUSD18: new(big.Int).Set(eventValue), Triggered: triggered,
			ProtectedUSD18: new(big.Int).Set(protected), ProtectBPS: protectBPS, ScheduleID: scheduleID}
		state.Authorizations[request.EventHash] = authorization
	}
	state.UsedNonces[request.Nonce] = struct{}{}
	authorization.LastExpiry = df.Timestamp + config.ResultValiditySeconds
	if err := e.store.Save(request.RuleID, state); err != nil {
		return buildResult(action, df, nil, 0, fmt.Errorf("persisting private evaluation state: %w", err))
	}
	e.policies[request.RuleID] = state
	e.evaluationCount++
	if triggered && !refreshing {
		e.successfulTriggers++
	}

	result := guardtypes.EvaluationResult{RuleID: request.RuleID, EventHash: request.EventHash,
		Triggered: triggered, EventValueUSD18: eventValue.String(), EvaluatedAt: df.Timestamp,
		Nonce: request.Nonce, ResultExpiry: authorization.LastExpiry}
	if triggered {
		result.ProtectedUSD18 = protected.String()
		result.ProtectBPS = protectBPS
		result.ScheduleID = scheduleID
	}
	result.ResultHash, err = evaluationResultHash(result)
	if err != nil {
		return buildResult(action, df, nil, 0, err)
	}
	encodedProtected, err := parseUint256(defaultZero(result.ProtectedUSD18), true)
	if err != nil {
		return buildResult(action, df, nil, 0, err)
	}
	response, err := decision.Encode(decision.FCCDecision{
		Domain: decision.Domain, RuleID: result.RuleID, EventHash: result.EventHash,
		Triggered: result.Triggered, ProtectedUSD18: encodedProtected, ProtectBPS: result.ProtectBPS,
		ScheduleID: result.ScheduleID, EventValueUSD18: eventValue, EvaluatedAt: result.EvaluatedAt,
		Nonce: new(big.Int).SetUint64(result.Nonce), ResultExpiry: result.ResultExpiry,
	})
	if err != nil {
		return buildResult(action, df, nil, 0, fmt.Errorf("encoding FCC decision ABI: %w", err))
	}
	return buildResult(action, df, response, 1, nil)
}

// clonePolicyState ensures a failed durable write cannot be acknowledged later
// through mutated process memory. It also keeps concurrent evaluations serialized
// by the extension mutex while each successful update is atomically persisted.
func clonePolicyState(source *policyState) (*policyState, error) {
	var buf bytes.Buffer
	if err := gob.NewEncoder(&buf).Encode(source); err != nil {
		return nil, err
	}
	var copied policyState
	if err := gob.NewDecoder(&buf).Decode(&copied); err != nil {
		return nil, err
	}
	return &copied, nil
}

func decodeStrictJSON(data []byte, target any) error {
	decoder := json.NewDecoder(bytes.NewReader(data))
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(target); err != nil {
		return err
	}
	if err := decoder.Decode(&struct{}{}); err != io.EOF {
		return fmt.Errorf("payload must contain exactly one JSON value")
	}
	return nil
}
