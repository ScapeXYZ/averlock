package extension

import (
	"context"
	"encoding/json"
	"fmt"
	"math/big"
	"net/http"
	"net/http/httptest"
	"os"
	"strings"
	"sync"
	"testing"
	"time"

	"extension-scaffold/internal/config"
	"extension-scaffold/pkg/decision"
	guardtypes "extension-scaffold/pkg/types"

	"github.com/ethereum/go-ethereum/common"
	"github.com/ethereum/go-ethereum/common/hexutil"
	teetypes "github.com/flare-foundation/tee-node/pkg/types"
	teeutils "github.com/flare-foundation/tee-node/pkg/utils"
)

const (
	oneThousandUSD18  = "1000000000000000000000"
	twoThousandUSD18  = "2000000000000000000000"
	fiveHundredUSD18  = "500000000000000000000"
	fiveThousandUSD18 = "5000000000000000000000"
)

var (
	ruleID = common.HexToHash("0xa11ce")
	event1 = common.HexToHash("0xe001")
	event2 = common.HexToHash("0xe002")
	event3 = common.HexToHash("0xe003")
)

type fixtureDecryptor struct{}

type failingStateStore struct {
	*memoryStore
	fail bool
}

func (s *failingStateStore) Save(rule common.Hash, state *policyState) error {
	if s.fail {
		return fmt.Errorf("forced durable write failure")
	}
	return s.memoryStore.Save(rule, state)
}

type blockingSnapshotReader struct{}

func (blockingSnapshotReader) GetSnapshot(ctx context.Context, _ common.Hash) (eventSnapshot, error) {
	<-ctx.Done()
	return eventSnapshot{}, ctx.Err()
}

func (blockingSnapshotReader) Ready(ctx context.Context) error {
	<-ctx.Done()
	return ctx.Err()
}

// Test-only: treats ciphertext bytes as plaintext policy JSON. This validates
// handler wiring, not production confidentiality or TEE decryption.
func (fixtureDecryptor) Decrypt(_ context.Context, ciphertext []byte) ([]byte, error) {
	return ciphertext, nil
}

func TestActionServiceReadyWhenSnapshotDependencyHealthy(t *testing.T) {
	e := newWithDependencies(0, fixtureDecryptor{}, &staticSnapshotReader{})
	recorder := httptest.NewRecorder()
	e.Server.Handler.ServeHTTP(recorder, httptest.NewRequest(http.MethodGet, "/ready", nil))
	if recorder.Code != http.StatusOK || !strings.Contains(recorder.Body.String(), `"status":"ready"`) {
		t.Fatalf("unexpected readiness response: code=%d body=%q", recorder.Code, recorder.Body.String())
	}
}

func TestActionServiceNotReadyWhenSnapshotDependencyUnavailable(t *testing.T) {
	e := newWithDependencies(0, fixtureDecryptor{}, &staticSnapshotReader{err: fmt.Errorf("rpc unavailable")})
	recorder := httptest.NewRecorder()
	e.Server.Handler.ServeHTTP(recorder, httptest.NewRequest(http.MethodGet, "/ready", nil))
	if recorder.Code != http.StatusServiceUnavailable {
		t.Fatalf("false READY state: code=%d body=%q", recorder.Code, recorder.Body.String())
	}
}

func TestActionServiceReadinessTimesOutFailClosed(t *testing.T) {
	original := snapshotReadyTimeout
	snapshotReadyTimeout = 10 * time.Millisecond
	t.Cleanup(func() { snapshotReadyTimeout = original })
	e := newWithDependencies(0, fixtureDecryptor{}, blockingSnapshotReader{})
	recorder := httptest.NewRecorder()
	e.Server.Handler.ServeHTTP(recorder, httptest.NewRequest(http.MethodGet, "/ready", nil))
	if recorder.Code != http.StatusServiceUnavailable || !strings.Contains(recorder.Body.String(), "deadline exceeded") {
		t.Fatalf("timeout produced false READY: code=%d body=%q", recorder.Code, recorder.Body.String())
	}
}

func TestLiveSnapshotBatchFitsTeeNodeDeadline(t *testing.T) {
	if os.Getenv("AVERLOCK_LIVE_RPC_TEST") != "1" {
		t.Skip("set AVERLOCK_LIVE_RPC_TEST=1 for the read-only Coston2 latency check")
	}
	reader := newGuardManagerReader()
	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
	defer cancel()
	started := time.Now()
	snapshot, err := reader.GetSnapshot(ctx, common.HexToHash("0xc4d12008caea289e8809d9f2884522ed85aac29600e43d1f07a566c896514819"))
	if err != nil {
		t.Fatal(err)
	}
	if snapshot.RuleID != common.HexToHash("0x2a3a9591def2b67120f829c342d002de5e2def49ac0f4044a6be143071489400") || snapshot.Consumed {
		t.Fatalf("unexpected live snapshot: %+v", snapshot)
	}
	if elapsed := time.Since(started); elapsed >= 2*time.Second {
		t.Fatalf("snapshot batch exceeded tee-node deadline: %s", elapsed)
	} else {
		t.Logf("live snapshot batch completed in %s", elapsed)
	}
}

func policyFixture() guardtypes.Policy {
	return guardtypes.Policy{RuleID: ruleID, ThresholdUSD18: oneThousandUSD18,
		ProtectBPS: 7000, ScheduleID: 1, MaxPerEventUSD18: fiveThousandUSD18,
		CooldownSeconds: 3600, ExpiresAt: 200000}
}

func mustBigInt(value string) *big.Int {
	parsed, ok := new(big.Int).SetString(value, 10)
	if !ok {
		panic("invalid test integer")
	}
	return parsed
}

func buildTestAction(command string, payload []byte) teetypes.Action {
	return buildTestActionAt(command, payload, 90000)
}

func buildTestActionAt(command string, payload []byte, timestamp uint64) teetypes.Action {
	type dataFixed struct {
		InstructionID      common.Hash    `json:"instructionId"`
		TeeID              common.Address `json:"teeId"`
		Timestamp          uint64         `json:"timestamp"`
		RewardEpochID      uint32         `json:"rewardEpochId"`
		OPType             common.Hash    `json:"opType"`
		OPCommand          common.Hash    `json:"opCommand"`
		Cosigners          []string       `json:"cosigners"`
		CosignersThreshold uint64         `json:"cosignersThreshold"`
		OriginalMessage    hexutil.Bytes  `json:"originalMessage"`
	}
	message, _ := json.Marshal(dataFixed{Timestamp: timestamp,
		OPType: teeutils.ToHash(config.OPTypeAverlockGuard), OPCommand: teeutils.ToHash(command),
		OriginalMessage: payload})
	return teetypes.Action{Data: teetypes.ActionData{ID: common.HexToHash("0x1234"), SubmissionTag: "local-fixture", Message: message}}
}

func invoke(t *testing.T, e *Extension, command string, request any) teetypes.ActionResult {
	return invokeAt(t, e, command, request, 90000)
}

func invokeAt(t *testing.T, e *Extension, command string, request any, timestamp uint64) teetypes.ActionResult {
	t.Helper()
	payload, err := json.Marshal(request)
	if err != nil {
		t.Fatal(err)
	}
	status, body := e.processAction(buildTestActionAt(command, payload, timestamp))
	if status != http.StatusOK {
		t.Fatalf("HTTP %d: %s", status, body)
	}
	var result teetypes.ActionResult
	if err := json.Unmarshal(body, &result); err != nil {
		t.Fatal(err)
	}
	return result
}

func createPolicy(t *testing.T, e *Extension, policy guardtypes.Policy) guardtypes.CreatePolicyResponse {
	t.Helper()
	plaintext, _ := json.Marshal(policy)
	result := invoke(t, e, config.OPCommandCreatePolicy, guardtypes.CreatePolicyRequest{EncryptedPolicy: plaintext})
	if result.Status != 1 {
		t.Fatalf("create policy failed: %s", result.Log)
	}
	var response guardtypes.CreatePolicyResponse
	if err := json.Unmarshal(result.Data, &response); err != nil {
		t.Fatal(err)
	}
	return response
}

func evaluate(t *testing.T, e *Extension, eventHash common.Hash, value string, timestamp, nonce uint64) (teetypes.ActionResult, guardtypes.EvaluationResult) {
	t.Helper()
	parsed, ok := new(big.Int).SetString(value, 10)
	if !ok {
		t.Fatalf("invalid fixture value %q", value)
	}
	reader, ok := e.snapshots.(*staticSnapshotReader)
	if !ok {
		t.Fatal("test extension does not use static snapshot reader")
	}
	reader.snapshot = eventSnapshot{RuleID: ruleID, EventValueUSD18: parsed,
		PriceUSD18: big.NewInt(1e18), PriceTimestamp: timestamp, PreparedAt: timestamp - 1}
	result := invokeAt(t, e, config.OPCommandEvaluateGuard, guardtypes.EvaluateGuardRequest{
		RuleID: ruleID, EventHash: eventHash, Nonce: nonce}, timestamp)
	var response guardtypes.EvaluationResult
	if result.Status == 1 {
		decoded, err := decision.Decode(result.Data)
		if err != nil {
			t.Fatal(err)
		}
		response = evaluationFromDecision(decoded)
	}
	return result, response
}

func evaluationFromDecision(d decision.FCCDecision) guardtypes.EvaluationResult {
	return guardtypes.EvaluationResult{
		RuleID: d.RuleID, EventHash: d.EventHash, Triggered: d.Triggered,
		ProtectedUSD18: d.ProtectedUSD18.String(), ProtectBPS: d.ProtectBPS, ScheduleID: d.ScheduleID,
		EventValueUSD18: d.EventValueUSD18.String(), EvaluatedAt: d.EvaluatedAt,
		Nonce: d.Nonce.Uint64(), ResultExpiry: d.ResultExpiry,
	}
}

func TestValidPolicyAccepted(t *testing.T) {
	response := createPolicy(t, newWithDecryptor(0, fixtureDecryptor{}), policyFixture())
	if !response.Accepted || response.RuleID != ruleID || response.PolicyCommitment == (common.Hash{}) {
		t.Fatal("invalid acknowledgement")
	}
}

func TestDurableWriteFailureIsNotAcknowledgedOrRetainedInMemory(t *testing.T) {
	e := newWithDecryptor(0, fixtureDecryptor{})
	store := &failingStateStore{memoryStore: newMemoryStore()}
	e.store = store
	createPolicy(t, e, policyFixture())
	store.fail = true
	result, _ := evaluate(t, e, event1, twoThousandUSD18, 100000, 77)
	if result.Status != 0 || !strings.Contains(result.Log, "persisting private evaluation state") {
		t.Fatalf("write failure was acknowledged: %+v", result)
	}
	if _, used := e.policies[ruleID].UsedNonces[77]; used {
		t.Fatal("failed Redis write leaked replay state into memory")
	}
}

func TestPublicStateEndpointDoesNotExposePrivatePolicy(t *testing.T) {
	e := newWithDecryptor(0, fixtureDecryptor{})
	createPolicy(t, e, policyFixture())
	recorder := httptest.NewRecorder()
	e.Server.Handler.ServeHTTP(recorder, httptest.NewRequest(http.MethodGet, "/state", nil))
	body := recorder.Body.String()
	if recorder.Code != http.StatusOK || strings.Contains(body, oneThousandUSD18) || strings.Contains(body, "7000") {
		t.Fatalf("public state endpoint leaked private policy: %s", body)
	}
}

func TestConcurrentEvaluationsPersistAllReplayNonces(t *testing.T) {
	e := newWithDecryptor(0, fixtureDecryptor{})
	createPolicy(t, e, policyFixture())
	e.snapshots.(*staticSnapshotReader).snapshot = eventSnapshot{RuleID: ruleID, EventValueUSD18: mustBigInt(twoThousandUSD18), PriceUSD18: big.NewInt(1e18), PriceTimestamp: 100000, PreparedAt: 99999}
	var wg sync.WaitGroup
	errs := make(chan error, 2)
	for i := uint64(1); i <= 2; i++ {
		wg.Add(1)
		go func(nonce uint64) {
			defer wg.Done()
			result := invokeAt(t, e, config.OPCommandEvaluateGuard, guardtypes.EvaluateGuardRequest{RuleID: ruleID, EventHash: common.BigToHash(new(big.Int).SetUint64(nonce + 100)), Nonce: nonce}, 100000)
			if result.Status != 1 {
				errs <- fmt.Errorf("evaluation %d: %s", nonce, result.Log)
			}
		}(i)
	}
	wg.Wait()
	close(errs)
	for err := range errs {
		t.Error(err)
	}
	if len(e.policies[ruleID].UsedNonces) != 2 {
		t.Fatal("concurrent updates lost replay state")
	}
}

func TestZeroThresholdRejected(t *testing.T) {
	p := policyFixture()
	p.ThresholdUSD18 = "0"
	if _, err := normalizePolicy(p); err == nil {
		t.Fatal("expected error")
	}
}

func TestZeroProtectBPSRejected(t *testing.T) {
	p := policyFixture()
	p.ProtectBPS = 0
	if _, err := normalizePolicy(p); err == nil {
		t.Fatal("expected error")
	}
}

func TestProtectBPSAboveMaximumRejected(t *testing.T) {
	p := policyFixture()
	p.ProtectBPS = 10001
	if _, err := normalizePolicy(p); err == nil {
		t.Fatal("expected error")
	}
}

func TestUnsupportedScheduleRejected(t *testing.T) {
	p := policyFixture()
	p.ScheduleID = 2
	if _, err := normalizePolicy(p); err == nil {
		t.Fatal("expected error")
	}
}

func TestMalformedPolicyRejected(t *testing.T) {
	e := newWithDecryptor(0, fixtureDecryptor{})
	result := invoke(t, e, config.OPCommandCreatePolicy, guardtypes.CreatePolicyRequest{EncryptedPolicy: []byte(`{"ruleId":`)})
	if result.Status != 0 || !strings.Contains(result.Log, "decoding decrypted policy") {
		t.Fatalf("unexpected result: %+v", result)
	}
}

func TestBelowThresholdNotTriggered(t *testing.T) {
	e := newWithDecryptor(0, fixtureDecryptor{})
	createPolicy(t, e, policyFixture())
	_, response := evaluate(t, e, event1, fiveHundredUSD18, 100000, 1)
	if response.Triggered {
		t.Fatal("must not trigger")
	}
}

func TestExactlyThresholdNotTriggered(t *testing.T) {
	e := newWithDecryptor(0, fixtureDecryptor{})
	createPolicy(t, e, policyFixture())
	_, response := evaluate(t, e, event1, oneThousandUSD18, 100000, 1)
	if response.Triggered {
		t.Fatal("strict greater-than rule must not trigger")
	}
}

func TestAboveThresholdTriggered(t *testing.T) {
	e := newWithDecryptor(0, fixtureDecryptor{})
	createPolicy(t, e, policyFixture())
	_, response := evaluate(t, e, event1, twoThousandUSD18, 100000, 1)
	if !response.Triggered {
		t.Fatal("expected trigger")
	}
}

func TestSeventyPercentProtectionMath(t *testing.T) {
	e := newWithDecryptor(0, fixtureDecryptor{})
	createPolicy(t, e, policyFixture())
	_, response := evaluate(t, e, event1, twoThousandUSD18, 100000, 1)
	if response.ProtectedUSD18 != "1400000000000000000000" {
		t.Fatalf("got %s", response.ProtectedUSD18)
	}
}

func TestEvaluationUsesTrustedInstructionTimestamp(t *testing.T) {
	e := newWithDecryptor(0, fixtureDecryptor{})
	createPolicy(t, e, policyFixture())
	_, response := evaluate(t, e, event1, twoThousandUSD18, 150000, 1)
	if response.EvaluatedAt != 150000 || response.ResultExpiry != 150600 {
		t.Fatalf("unexpected trusted evaluation window: evaluated=%d expiry=%d", response.EvaluatedAt, response.ResultExpiry)
	}
}

func TestClientSuppliedEventTimestampRejected(t *testing.T) {
	e := newWithDecryptor(0, fixtureDecryptor{})
	createPolicy(t, e, policyFixture())
	request := map[string]any{"ruleId": ruleID, "eventHash": event1,
		"eventValueUsd18": twoThousandUSD18, "eventTimestamp": uint64(1), "nonce": uint64(1)}
	result := invokeAt(t, e, config.OPCommandEvaluateGuard, request, 150000)
	if result.Status != 0 || !strings.Contains(result.Log, "unknown field") {
		t.Fatalf("client timestamp was not rejected: status=%d log=%q", result.Status, result.Log)
	}
}

func TestClientSuppliedEventValueRejected(t *testing.T) {
	e := newWithDecryptor(0, fixtureDecryptor{})
	createPolicy(t, e, policyFixture())
	request := map[string]any{"ruleId": ruleID, "eventHash": event1,
		"eventValueUsd18": twoThousandUSD18, "nonce": uint64(1)}
	result := invokeAt(t, e, config.OPCommandEvaluateGuard, request, 150000)
	if result.Status != 0 || !strings.Contains(result.Log, "unknown field") {
		t.Fatalf("client event value was not rejected: status=%d log=%q", result.Status, result.Log)
	}
}

func TestClientCannotSupplySnapshotPrice(t *testing.T) {
	e := newWithDecryptor(0, fixtureDecryptor{})
	createPolicy(t, e, policyFixture())
	request := map[string]any{"ruleId": ruleID, "eventHash": event1,
		"priceUsd18": oneThousandUSD18, "nonce": uint64(1)}
	result := invokeAt(t, e, config.OPCommandEvaluateGuard, request, 150000)
	if result.Status != 0 || !strings.Contains(result.Log, "unknown field") {
		t.Fatalf("client snapshot price was not rejected: status=%d log=%q", result.Status, result.Log)
	}
}

func TestSnapshotRuleMismatchRejected(t *testing.T) {
	e := newWithDependencies(0, fixtureDecryptor{}, &staticSnapshotReader{snapshot: eventSnapshot{
		RuleID: common.HexToHash("0xdead"), EventValueUSD18: mustBigInt(twoThousandUSD18),
		PriceUSD18: mustBigInt(oneThousandUSD18), PreparedAt: 1,
	}})
	createPolicy(t, e, policyFixture())
	result := invokeAt(t, e, config.OPCommandEvaluateGuard,
		guardtypes.EvaluateGuardRequest{RuleID: ruleID, EventHash: event1, Nonce: 1}, 150000)
	if result.Status != 0 || !strings.Contains(result.Log, "snapshot ruleId mismatch") {
		t.Fatalf("unexpected: %s", result.Log)
	}
}

func TestMissingSnapshotRejected(t *testing.T) {
	e := newWithDependencies(0, fixtureDecryptor{}, &staticSnapshotReader{})
	createPolicy(t, e, policyFixture())
	result := invokeAt(t, e, config.OPCommandEvaluateGuard,
		guardtypes.EvaluateGuardRequest{RuleID: ruleID, EventHash: event1, Nonce: 1}, 150000)
	if result.Status != 0 || !strings.Contains(result.Log, "snapshot ruleId mismatch") {
		t.Fatalf("unexpected: %s", result.Log)
	}
}

func TestOldManagerConfigurationRejected(t *testing.T) {
	original := config.GuardManagerAddress
	defer func() { config.GuardManagerAddress = original }()
	config.GuardManagerAddress = common.HexToAddress("0x3e93537EbB9a389D33943Cb4D2911bEC1f69E872")
	reader := newGuardManagerReader()
	_, err := reader.GetSnapshot(context.Background(), event1)
	if err == nil || !strings.Contains(err.Error(), "not safely configured") {
		t.Fatalf("old manager did not fail closed: %v", err)
	}
}

func TestExpectedManagerConfigurationAccepted(t *testing.T) {
	reader := newGuardManagerReader().(*guardManagerReader)
	if reader.manager != common.HexToAddress(config.ExpectedGuardManager) {
		t.Fatalf("wrong GuardManager: %s", reader.manager)
	}
}

func TestMaxPerEventCapBlocksTrigger(t *testing.T) {
	e := newWithDecryptor(0, fixtureDecryptor{})
	createPolicy(t, e, policyFixture())
	_, response := evaluate(t, e, event1, "6000000000000000000000", 100000, 1)
	if response.Triggered {
		t.Fatal("cap must block")
	}
}

func TestExpiredPolicyRejected(t *testing.T) {
	e := newWithDecryptor(0, fixtureDecryptor{})
	p := policyFixture()
	p.ExpiresAt = 100000
	createPolicy(t, e, p)
	result, _ := evaluate(t, e, event1, twoThousandUSD18, 100001, 1)
	if result.Status != 0 || !strings.Contains(result.Log, "expired") {
		t.Fatalf("unexpected: %s", result.Log)
	}
}

func TestDuplicateEventRejected(t *testing.T) {
	e := newWithDecryptor(0, fixtureDecryptor{})
	createPolicy(t, e, policyFixture())
	evaluate(t, e, event1, fiveHundredUSD18, 100000, 1)
	result, _ := evaluate(t, e, event1, fiveHundredUSD18, 100500, 2)
	if result.Status != 0 || !strings.Contains(result.Log, "authorization still active") {
		t.Fatalf("unexpected: %s", result.Log)
	}
}

func TestExpiredAuthorizationCanBeRefreshed(t *testing.T) {
	e := newWithDecryptor(0, fixtureDecryptor{})
	createPolicy(t, e, policyFixture())
	_, first := evaluate(t, e, event1, twoThousandUSD18, 100000, 1)
	_, refreshed := evaluate(t, e, event1, twoThousandUSD18, 100601, 2)
	if !refreshed.Triggered || refreshed.EvaluatedAt != 100601 || refreshed.ResultExpiry != 101201 {
		t.Fatalf("unexpected refreshed result: %+v", refreshed)
	}
	if refreshed.ProtectedUSD18 != first.ProtectedUSD18 || refreshed.ProtectBPS != first.ProtectBPS ||
		refreshed.ScheduleID != first.ScheduleID || refreshed.EventValueUSD18 != first.EventValueUSD18 {
		t.Fatalf("refresh changed immutable decision: first=%+v refreshed=%+v", first, refreshed)
	}
	if e.successfulTriggers != 1 {
		t.Fatalf("reauthorization counted as a new economic trigger: %d", e.successfulTriggers)
	}
}

func TestRefreshRequiresSameEventValue(t *testing.T) {
	e := newWithDecryptor(0, fixtureDecryptor{})
	createPolicy(t, e, policyFixture())
	evaluate(t, e, event1, twoThousandUSD18, 100000, 1)
	reader := e.snapshots.(*staticSnapshotReader)
	reader.snapshot.EventValueUSD18 = new(big.Int).SetUint64(1)
	result := invokeAt(t, e, config.OPCommandEvaluateGuard,
		guardtypes.EvaluateGuardRequest{RuleID: ruleID, EventHash: event1, Nonce: 2}, 100601)
	if result.Status != 0 || !strings.Contains(result.Log, "event value mismatch") {
		t.Fatalf("unexpected: %s", result.Log)
	}
}

func TestRefreshRequiresFreshNonce(t *testing.T) {
	e := newWithDecryptor(0, fixtureDecryptor{})
	createPolicy(t, e, policyFixture())
	evaluate(t, e, event1, twoThousandUSD18, 100000, 7)
	result, _ := evaluate(t, e, event1, twoThousandUSD18, 100601, 7)
	if result.Status != 0 || !strings.Contains(result.Log, "nonce replay") {
		t.Fatalf("unexpected: %s", result.Log)
	}
}

func TestConsumedGuardManagerEventCannotBeRefreshed(t *testing.T) {
	e := newWithDependencies(0, fixtureDecryptor{}, &staticSnapshotReader{})
	createPolicy(t, e, policyFixture())
	evaluate(t, e, event1, twoThousandUSD18, 100000, 1)
	reader := e.snapshots.(*staticSnapshotReader)
	reader.snapshot.Consumed = true
	result := invoke(t, e, config.OPCommandEvaluateGuard,
		guardtypes.EvaluateGuardRequest{RuleID: ruleID, EventHash: event1, Nonce: 2})
	if result.Status != 0 || !strings.Contains(result.Log, "consumed onchain") {
		t.Fatalf("unexpected: %s", result.Log)
	}
}

func TestConsumptionLookupFailsClosed(t *testing.T) {
	e := newWithDependencies(0, fixtureDecryptor{}, &staticSnapshotReader{err: fmt.Errorf("rpc unavailable")})
	createPolicy(t, e, policyFixture())
	result := invoke(t, e, config.OPCommandEvaluateGuard,
		guardtypes.EvaluateGuardRequest{RuleID: ruleID, EventHash: event1, Nonce: 1})
	if result.Status != 0 || !strings.Contains(result.Log, "reading GuardManager snapshot") {
		t.Fatalf("unexpected: %s", result.Log)
	}
}

func TestDuplicateNonceRejected(t *testing.T) {
	e := newWithDecryptor(0, fixtureDecryptor{})
	createPolicy(t, e, policyFixture())
	evaluate(t, e, event1, fiveHundredUSD18, 100000, 7)
	result, _ := evaluate(t, e, event2, twoThousandUSD18, 110000, 7)
	if result.Status != 0 || !strings.Contains(result.Log, "nonce replay") {
		t.Fatalf("unexpected: %s", result.Log)
	}
}

func TestCooldownBlocksPrematureTrigger(t *testing.T) {
	e := newWithDecryptor(0, fixtureDecryptor{})
	createPolicy(t, e, policyFixture())
	evaluate(t, e, event1, twoThousandUSD18, 100000, 1)
	_, response := evaluate(t, e, event2, twoThousandUSD18, 103599, 2)
	if response.Triggered {
		t.Fatal("cooldown must block")
	}
}

func TestTriggerSucceedsAfterCooldown(t *testing.T) {
	e := newWithDecryptor(0, fixtureDecryptor{})
	createPolicy(t, e, policyFixture())
	evaluate(t, e, event1, twoThousandUSD18, 100000, 1)
	_, response := evaluate(t, e, event2, twoThousandUSD18, 103600, 2)
	if !response.Triggered {
		t.Fatal("expected trigger at cooldown boundary")
	}
}

func TestUnknownRuleRejected(t *testing.T) {
	e := newWithDecryptor(0, fixtureDecryptor{})
	result, _ := evaluate(t, e, event1, twoThousandUSD18, 100000, 1)
	if result.Status != 0 || !strings.Contains(result.Log, "unknown ruleId") {
		t.Fatalf("unexpected: %s", result.Log)
	}
}

func TestPolicyCommitmentDeterministic(t *testing.T) {
	p, _ := normalizePolicy(policyFixture())
	first, _ := policyCommitment(p)
	second, _ := policyCommitment(p)
	if first != second {
		t.Fatal("commitment changed")
	}
}

func TestChangingAnyPolicyFieldChangesCommitment(t *testing.T) {
	base, _ := normalizePolicy(policyFixture())
	expected, _ := policyCommitment(base)
	variants := []normalizedPolicy{base, base, base, base, base, base, base}
	variants[0].RuleID = common.HexToHash("0xbeef")
	variants[1].ThresholdUSD18 = new(big.Int).Add(base.ThresholdUSD18, big.NewInt(1))
	variants[2].ProtectBPS--
	variants[3].ScheduleID++
	variants[4].MaxPerEventUSD18 = new(big.Int).Sub(base.MaxPerEventUSD18, big.NewInt(1))
	variants[5].CooldownSeconds++
	variants[6].ExpiresAt++
	for i, policy := range variants {
		got, _ := policyCommitment(policy)
		if got == expected {
			t.Fatalf("variant %d did not change commitment", i)
		}
	}
}

func TestResultHashDomainSeparationDeterministic(t *testing.T) {
	result := guardtypes.EvaluationResult{RuleID: ruleID, EventHash: event1, Triggered: true,
		ProtectedUSD18: "1400000000000000000000", ProtectBPS: 7000, ScheduleID: 1,
		EventValueUSD18: twoThousandUSD18, EvaluatedAt: 100000, Nonce: 1, ResultExpiry: 100600}
	first, _ := evaluationResultHash(result)
	second, _ := evaluationResultHash(result)
	if first != second || first == (common.Hash{}) {
		t.Fatal("non-deterministic hash")
	}
	result.Nonce++
	changed, _ := evaluationResultHash(result)
	if changed == first {
		t.Fatal("nonce not bound")
	}
}

func TestPublicResultOmitsThresholdAndPrivateTerms(t *testing.T) {
	e := newWithDecryptor(0, fixtureDecryptor{})
	createPolicy(t, e, policyFixture())
	_, response := evaluate(t, e, event1, twoThousandUSD18, 100000, 1)
	encoded, _ := json.Marshal(response)
	for _, forbidden := range []string{"threshold", oneThousandUSD18, "maxPerEvent", "cooldown", "expiresAt", "encryptedPolicy"} {
		if strings.Contains(string(encoded), forbidden) {
			t.Fatalf("public result leaked %q: %s", forbidden, encoded)
		}
	}
}

func TestLocalHandlerCreateThenEvaluateExamples(t *testing.T) {
	e := newWithDecryptor(0, fixtureDecryptor{})
	p := policyFixture()
	p.CooldownSeconds = 0
	createPolicy(t, e, p)
	_, high := evaluate(t, e, event1, twoThousandUSD18, 100000, 1)
	if !high.Triggered || high.ProtectedUSD18 != "1400000000000000000000" || high.ScheduleID != 1 {
		t.Fatalf("unexpected high result: %+v", high)
	}
	_, low := evaluate(t, e, event2, fiveHundredUSD18, 100001, 2)
	if low.Triggered {
		t.Fatalf("unexpected low result: %+v", low)
	}
}

func TestMalformedEvaluationRejected(t *testing.T) {
	e := newWithDecryptor(0, fixtureDecryptor{})
	status, body := e.processAction(buildTestAction(config.OPCommandEvaluateGuard, []byte(`{"ruleId":`)))
	if status != http.StatusOK {
		t.Fatalf("HTTP %d", status)
	}
	var result teetypes.ActionResult
	_ = json.Unmarshal(body, &result)
	if result.Status != 0 {
		t.Fatal("expected malformed payload rejection")
	}
}

func TestHTTPActionHandlerLocalCreateAndEvaluate(t *testing.T) {
	e := newWithDecryptor(0, fixtureDecryptor{})
	policy := policyFixture()
	policy.CooldownSeconds = 0
	plaintext, _ := json.Marshal(policy)
	createRequest, _ := json.Marshal(guardtypes.CreatePolicyRequest{EncryptedPolicy: plaintext})
	createAction, _ := json.Marshal(buildTestAction(config.OPCommandCreatePolicy, createRequest))
	createRecorder := httptest.NewRecorder()
	e.Server.Handler.ServeHTTP(createRecorder, httptest.NewRequest(http.MethodPost, "/action", strings.NewReader(string(createAction))))
	if createRecorder.Code != http.StatusOK {
		t.Fatalf("CREATE_POLICY HTTP %d: %s", createRecorder.Code, createRecorder.Body.String())
	}

	e.snapshots.(*staticSnapshotReader).snapshot = eventSnapshot{RuleID: ruleID,
		EventValueUSD18: mustBigInt(twoThousandUSD18), PriceUSD18: big.NewInt(1e18), PreparedAt: 99999}
	evaluateRequest, _ := json.Marshal(guardtypes.EvaluateGuardRequest{RuleID: ruleID, EventHash: event3, Nonce: 99})
	evaluateAction, _ := json.Marshal(buildTestActionAt(config.OPCommandEvaluateGuard, evaluateRequest, 100000))
	evaluateRecorder := httptest.NewRecorder()
	e.Server.Handler.ServeHTTP(evaluateRecorder, httptest.NewRequest(http.MethodPost, "/action", strings.NewReader(string(evaluateAction))))
	if evaluateRecorder.Code != http.StatusOK {
		t.Fatalf("EVALUATE_GUARD HTTP %d: %s", evaluateRecorder.Code, evaluateRecorder.Body.String())
	}
	var actionResult teetypes.ActionResult
	if err := json.Unmarshal(evaluateRecorder.Body.Bytes(), &actionResult); err != nil {
		t.Fatal(err)
	}
	decoded, err := decision.Decode(actionResult.Data)
	if err != nil {
		t.Fatal(err)
	}
	evaluation := evaluationFromDecision(decoded)
	if !evaluation.Triggered || evaluation.ProtectedUSD18 != "1400000000000000000000" || evaluation.ScheduleID != 1 {
		t.Fatalf("unexpected local /action result: %+v", evaluation)
	}

	e.snapshots.(*staticSnapshotReader).snapshot = eventSnapshot{RuleID: ruleID,
		EventValueUSD18: mustBigInt(fiveHundredUSD18), PriceUSD18: big.NewInt(1e18), PreparedAt: 100000}
	lowRequest, _ := json.Marshal(guardtypes.EvaluateGuardRequest{RuleID: ruleID, EventHash: event2, Nonce: 100})
	lowAction, _ := json.Marshal(buildTestActionAt(config.OPCommandEvaluateGuard, lowRequest, 100001))
	lowRecorder := httptest.NewRecorder()
	e.Server.Handler.ServeHTTP(lowRecorder, httptest.NewRequest(http.MethodPost, "/action", strings.NewReader(string(lowAction))))
	if lowRecorder.Code != http.StatusOK {
		t.Fatalf("low EVALUATE_GUARD HTTP %d: %s", lowRecorder.Code, lowRecorder.Body.String())
	}
	actionResult = teetypes.ActionResult{}
	if err := json.Unmarshal(lowRecorder.Body.Bytes(), &actionResult); err != nil {
		t.Fatal(err)
	}
	decoded, err = decision.Decode(actionResult.Data)
	if err != nil {
		t.Fatal(err)
	}
	evaluation = evaluationFromDecision(decoded)
	if evaluation.Triggered {
		t.Fatalf("unexpected $500 local /action trigger: %+v", evaluation)
	}
}
