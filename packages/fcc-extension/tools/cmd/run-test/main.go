package main

import (
	"context"
	"crypto/ecdsa"
	"crypto/rand"
	"encoding/json"
	"flag"
	"fmt"
	"math/big"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"time"

	"extension-scaffold/pkg/decision"
	"extension-scaffold/tools/pkg/configs"
	"extension-scaffold/tools/pkg/fccutils"
	"extension-scaffold/tools/pkg/support"
	instrutils "extension-scaffold/tools/pkg/utils"

	"github.com/ethereum/go-ethereum"
	"github.com/ethereum/go-ethereum/accounts/abi"
	"github.com/ethereum/go-ethereum/accounts/abi/bind"
	"github.com/ethereum/go-ethereum/common"
	"github.com/ethereum/go-ethereum/crypto"
	"github.com/ethereum/go-ethereum/crypto/ecies"
	"github.com/flare-foundation/go-flare-common/pkg/logger"
	csigning "github.com/flare-foundation/go-flare-common/pkg/signing"
	teetypes "github.com/flare-foundation/tee-node/pkg/types"
	teeutils "github.com/flare-foundation/tee-node/pkg/utils"
	"github.com/pkg/errors"
)

const (
	chainID                  = uint64(114)
	thresholdUSD18           = "1000000000000000000000"
	maxPerEventUSD18         = "10000000000000000000000"
	triggerValueUSD18        = "2000000000000000000000"
	nonTriggerValueUSD18     = "500000000000000000000"
	expectedProtectedUSD18   = "1400000000000000000000"
	expectedProtectBPS       = uint16(7000)
	expectedScheduleID       = uint32(1)
	expectedCooldownSeconds  = uint64(60)
	expectedDecisionLifetime = uint64(600)
)

var (
	bytes32Type, _ = abi.NewType("bytes32", "", nil)
	uint256Type, _ = abi.NewType("uint256", "", nil)
	uint16Type, _  = abi.NewType("uint16", "", nil)
	uint32Type, _  = abi.NewType("uint32", "", nil)
	uint64Type, _  = abi.NewType("uint64", "", nil)
	boolType, _    = abi.NewType("bool", "", nil)
	policyDomain   = crypto.Keccak256Hash([]byte("AVERLOCK_POLICY_V1"))
	resultDomain   = crypto.Keccak256Hash([]byte("AVERLOCK_GUARD_RESULT_V2"))
)

type policy struct {
	RuleID           common.Hash `json:"ruleId"`
	ThresholdUSD18   string      `json:"thresholdUsd18"`
	ProtectBPS       uint16      `json:"protectBps"`
	ScheduleID       uint32      `json:"scheduleId"`
	MaxPerEventUSD18 string      `json:"maxPerEventUsd18"`
	CooldownSeconds  uint64      `json:"cooldownSeconds"`
	ExpiresAt        uint64      `json:"expiresAt"`
}

type createPolicyResponse struct {
	RuleID           common.Hash `json:"ruleId"`
	Accepted         bool        `json:"accepted"`
	PolicyCommitment common.Hash `json:"policyCommitment"`
}

type evaluationResult = decision.FCCDecision

func main() {
	af := flag.String("a", configs.AddressesFile, "file with deployed addresses")
	cf := flag.String("c", configs.ChainNodeURL, "chain node url")
	pf := flag.String("p", configs.ExtensionProxyURL, "extension proxy url")
	resultProxy := flag.String("resultProxy", "", "optional proxy URL used only for ActionResult polling")
	senderFlag := flag.String("instructionSender", "", "InstructionSender address")
	extensionFlag := flag.String("extensionId", "", "expected registered extension ID")
	teeFlag := flag.String("tee", "", "optional explicit TEE address; cross-checked with live /info and on-chain state")
	createPolicyOnly := flag.Bool("createPolicyOnly", false, "create one encrypted policy, verify its signed acknowledgment, then stop")
	evaluateSnapshot := flag.Bool("evaluateGuardSnapshot", false, "read an existing GuardManager snapshot, evaluate it, and save its signed V2 ActionResult")
	ruleFlag := flag.String("ruleId", "", "existing rule ID for -evaluateGuardSnapshot")
	eventFlag := flag.String("eventHash", "", "prepared GuardManager event hash for -evaluateGuardSnapshot")
	artifactFlag := flag.String("resultArtifact", "", "gitignored JSON output path for -evaluateGuardSnapshot")
	restorePolicyArtifact := flag.String("restorePolicyArtifact", "", "gitignored exact policy JSON to restore")
	restoreActionID := flag.String("restoreActionId", "", "resume verification of an already-submitted policy restore without resubmitting")
	retireStaleTEEs := flag.Bool("retireStaleTees", false, "ban obsolete selectable TEEs owned by this signer before a one-time restore")
	expectedPolicyCommitment := flag.String("expectedPolicyCommitment", "", "required commitment for restored policy")
	guardManagerFlag := flag.String("guardManager", "", "GuardManager used to validate the restored commitment")
	flag.Parse()
	if *resultProxy == "" {
		*resultProxy = *pf
	}

	if !common.IsHexAddress(*senderFlag) {
		fccutils.FatalWithCause(errors.New("valid -instructionSender address is required"))
	}
	expectedExtensionID, ok := new(big.Int).SetString(strings.TrimPrefix(*extensionFlag, "0x"), 16)
	if !ok || expectedExtensionID.Sign() <= 0 {
		fccutils.FatalWithCause(errors.New("valid nonzero hexadecimal -extensionId is required"))
	}

	teeInfo, err := fccutils.TeeInfo(*pf)
	if err != nil {
		fccutils.FatalWithCause(errors.Errorf("fetch TEE info: %s", err))
	}
	if teeInfo.TeeInfo.ChainID != chainID {
		fccutils.FatalWithCause(errors.Errorf("wrong TEE chain ID: got %d, want %d", teeInfo.TeeInfo.ChainID, chainID))
	}
	ecdsaPub, err := teetypes.ParsePubKey(teeInfo.MachineData.PublicKey)
	if err != nil {
		fccutils.FatalWithCause(errors.Errorf("parse TEE public key: %s", err))
	}
	derivedTEE := crypto.PubkeyToAddress(*ecdsaPub)
	if *teeFlag != "" {
		if !common.IsHexAddress(*teeFlag) {
			fccutils.FatalWithCause(errors.New("-tee must be a valid address when provided"))
		}
		configuredTEE := common.HexToAddress(*teeFlag)
		if derivedTEE != configuredTEE {
			fccutils.FatalWithCause(errors.Errorf("configured TEE mismatch: live /info=%s configured=%s", derivedTEE.Hex(), configuredTEE.Hex()))
		}
	}

	s, err := support.DefaultSupport(*af, *cf)
	if err != nil {
		fccutils.FatalWithCause(err)
	}
	if s.ChainID.Uint64() != chainID {
		fccutils.FatalWithCause(errors.Errorf("wrong transaction chain ID: %s", s.ChainID))
	}
	machine, err := s.TeeMachineRegistry.GetTeeMachine(nil, derivedTEE)
	if err != nil || machine.TeeId != derivedTEE {
		fccutils.FatalWithCause(errors.Errorf("live /info TEE %s is not registered on-chain: %v", derivedTEE.Hex(), err))
	}
	status, err := s.TeeMachineRegistry.GetTeeMachineStatus(nil, derivedTEE)
	if err != nil || status != 2 {
		fccutils.FatalWithCause(errors.Errorf("live /info TEE %s is not PRODUCTION: status=%d err=%v", derivedTEE.Hex(), status, err))
	}
	onchainExtensionID, err := s.TeeMachineRegistry.GetExtensionId(nil, derivedTEE)
	if err != nil || onchainExtensionID.Cmp(expectedExtensionID) != 0 {
		fccutils.FatalWithCause(errors.Errorf("TEE extension mismatch: on-chain=%v expected=%s err=%v", onchainExtensionID, expectedExtensionID, err))
	}
	if strings.TrimRight(machine.Url, "/") != strings.TrimRight(*pf, "/") {
		fccutils.FatalWithCause(errors.Errorf("TEE proxy URL mismatch: on-chain=%q requested=%q", machine.Url, *pf))
	}
	expectedTEE := derivedTEE
	logger.Infof("LIVE_TEE_VALIDATED tee=%s status=PRODUCTION extensionId=%s url=%s", expectedTEE.Hex(), expectedExtensionID, machine.Url)

	sender := common.HexToAddress(*senderFlag)
	// Resuming an existing restore is strictly read-only: never call the
	// InstructionSender or submit any replacement instruction.
	if *restorePolicyArtifact == "" && !*evaluateSnapshot {
		if err = instrutils.SetExtensionId(s, sender); err != nil && !strings.Contains(err.Error(), "already set") {
			fccutils.FatalWithCause(err)
		}
	}
	if *evaluateSnapshot {
		evaluateExistingSnapshot(s, sender, *resultProxy, expectedTEE, *guardManagerFlag, *ruleFlag, *eventFlag, *artifactFlag)
		return
	}
	if *restorePolicyArtifact != "" {
		if *restoreActionID == "" {
			if *retireStaleTEEs {
				retireStaleMachines(s, expectedTEE, expectedExtensionID)
			}
			runInstructionReadinessGate(expectedTEE, expectedExtensionID)
		}
		restoreExistingPolicy(s, sender, *resultProxy, expectedTEE, *restorePolicyArtifact, *expectedPolicyCommitment, *guardManagerFlag, *restoreActionID, ecdsaPub)
		return
	}

	ruleID := randomHash()
	baseTimestamp := uint64(time.Now().Unix())
	privatePolicy := policy{
		RuleID: ruleID, ThresholdUSD18: thresholdUSD18, ProtectBPS: expectedProtectBPS,
		ScheduleID: expectedScheduleID, MaxPerEventUSD18: maxPerEventUSD18,
		CooldownSeconds: expectedCooldownSeconds, ExpiresAt: baseTimestamp + 7*24*60*60,
	}
	plaintext, err := json.Marshal(privatePolicy)
	if err != nil {
		fccutils.FatalWithCause(err)
	}
	ecPub := &ecies.PublicKey{X: ecdsaPub.X, Y: ecdsaPub.Y, Curve: ecies.DefaultCurve, Params: ecies.ECIES_AES128_SHA256}
	ciphertext, err := ecies.Encrypt(rand.Reader, ecPub, plaintext, nil, nil)
	clear(plaintext)
	if err != nil {
		fccutils.FatalWithCause(errors.Errorf("ECIES encrypt policy: %s", err))
	}
	logger.Infof("Prepared ECIES policy ciphertext: ruleId=%s bytes=%d", ruleID.Hex(), len(ciphertext))

	createPayload, _ := json.Marshal(map[string]any{"encryptedPolicy": ciphertext})
	createID, createTx, err := instrutils.SendCreatePolicy(s, sender, createPayload)
	clear(createPayload)
	clear(ciphertext)
	if err != nil {
		fccutils.FatalWithCause(err)
	}
	createResponse := mustResult(*pf, createID, expectedTEE, 1)
	var created createPolicyResponse
	if err = json.Unmarshal(createResponse.Result.Data, &created); err != nil || !created.Accepted || created.RuleID != ruleID {
		fccutils.FatalWithCause(errors.Errorf("CREATE_POLICY result invalid: %v", err))
	}
	expectedCommitment := mustPolicyCommitment(privatePolicy)
	if created.PolicyCommitment != expectedCommitment {
		fccutils.FatalWithCause(errors.New("policy commitment mismatch"))
	}
	assertPrivateFieldsAbsent(createResponse.Result.Data, privatePolicy)
	logger.Infof("CREATE_POLICY_OK ruleId=%s commitment=%s actionId=%s tx=%s signature=valid",
		ruleID.Hex(), created.PolicyCommitment.Hex(), createID.Hex(), createTx.Hex())
	if *createPolicyOnly {
		logger.Infof("AVERLOCK_CREATE_POLICY_COMPLETE")
		return
	}

	// The V2 request schema is strict: evaluation time is supplied only by the
	// trusted DataFixed envelope. A client-controlled legacy timestamp must
	// produce a signed failure result and must not enter rule state.
	malformedEvent := randomHash()
	malformedPayload, _ := json.Marshal(map[string]any{"ruleId": ruleID, "eventHash": malformedEvent,
		"eventTimestamp": uint64(1), "nonce": uint64(999)})
	malformedID, malformedTx, err := instrutils.SendEvaluateGuard(s, sender, malformedPayload)
	clear(malformedPayload)
	if err != nil {
		fccutils.FatalWithCause(err)
	}
	malformed := mustResult(*pf, malformedID, expectedTEE, 0)
	if !strings.Contains(strings.ToLower(malformed.Result.Log), "unknown field") ||
		!strings.Contains(malformed.Result.Log, "eventTimestamp") {
		fccutils.FatalWithCause(errors.Errorf("client eventTimestamp was not explicitly rejected: %q", malformed.Result.Log))
	}
	logger.Infof("CLIENT_EVENT_TIMESTAMP_REJECTED actionId=%s tx=%s signature=valid",
		malformedID.Hex(), malformedTx.Hex())

	triggerEvent := randomHash()
	trigger := sendEvaluation(s, sender, *pf, expectedTEE, ruleID, triggerEvent, triggerValueUSD18, 1, 1)
	if !trigger.Result.Triggered || trigger.Result.ProtectedUSD18.String() != expectedProtectedUSD18 ||
		trigger.Result.ProtectBPS != expectedProtectBPS || trigger.Result.ScheduleID != expectedScheduleID {
		fccutils.FatalWithCause(errors.Errorf("unexpected trigger result: %+v", trigger.Result))
	}
	logger.Infof("TRIGGER_OK eventHash=%s protectedUsd18=%s evaluatedAt=%d resultExpiry=%d lifetime=%d dataBytes=%d domain=%s actionId=%s tx=%s resultHash=%s signature=valid",
		triggerEvent.Hex(), trigger.Result.ProtectedUSD18, trigger.Result.EvaluatedAt, trigger.Result.ResultExpiry,
		trigger.Result.ResultExpiry-trigger.Result.EvaluatedAt, len(trigger.RawData), trigger.Result.Domain.Hex(),
		trigger.ActionID.Hex(), trigger.TxHash.Hex(), mustEvaluationHash(trigger.Result).Hex())

	// The same event and nonce must produce a signed FCC failure result, not a
	// second successful trigger.
	replay := sendEvaluation(s, sender, *pf, expectedTEE, ruleID, triggerEvent, triggerValueUSD18, 1, 0)
	if !strings.Contains(strings.ToLower(replay.Log), "replay") {
		fccutils.FatalWithCause(errors.Errorf("replay was not explicitly rejected: %q", replay.Log))
	}
	logger.Infof("REPLAY_REJECTED actionId=%s tx=%s signature=valid", replay.ActionID.Hex(), replay.TxHash.Hex())

	// A fresh otherwise-eligible event inside the private 60-second window must
	// be non-triggered. The public result intentionally does not reveal why.
	cooldownEvent := randomHash()
	cooldown := sendEvaluation(s, sender, *pf, expectedTEE, ruleID, cooldownEvent, triggerValueUSD18, 2, 1)
	if cooldown.Result.Triggered {
		fccutils.FatalWithCause(errors.New("cooldown event unexpectedly triggered"))
	}
	assertEvaluationPrivateFieldsAbsent(cooldown.RawData, privatePolicy)
	logger.Infof("COOLDOWN_BLOCKED eventHash=%s actionId=%s tx=%s signature=valid",
		cooldownEvent.Hex(), cooldown.ActionID.Hex(), cooldown.TxHash.Hex())

	nonTriggerEvent := randomHash()
	nonTrigger := sendEvaluation(s, sender, *pf, expectedTEE, ruleID, nonTriggerEvent, nonTriggerValueUSD18, 3, 1)
	if nonTrigger.Result.Triggered {
		fccutils.FatalWithCause(errors.New("$500 event unexpectedly triggered"))
	}
	assertEvaluationPrivateFieldsAbsent(nonTrigger.RawData, privatePolicy)
	logger.Infof("NON_TRIGGER_OK eventHash=%s evaluatedAt=%d resultExpiry=%d lifetime=%d dataBytes=%d domain=%s actionId=%s tx=%s resultHash=%s signature=valid",
		nonTriggerEvent.Hex(), nonTrigger.Result.EvaluatedAt, nonTrigger.Result.ResultExpiry,
		nonTrigger.Result.ResultExpiry-nonTrigger.Result.EvaluatedAt, len(nonTrigger.RawData), nonTrigger.Result.Domain.Hex(),
		nonTrigger.ActionID.Hex(), nonTrigger.TxHash.Hex(), mustEvaluationHash(nonTrigger.Result).Hex())
	logger.Infof("AVERLOCK_PHASE5C_ACTIONS_COMPLETE")
}

func retireStaleMachines(s *support.Support, expectedTEE common.Address, expectedExtensionID *big.Int) {
	active, err := s.TeeMachineRegistry.GetActiveTeeMachines(nil, expectedExtensionID)
	if err != nil {
		fccutils.FatalWithCause(errors.Errorf("query active TEEs before retirement: %v", err))
	}
	owner := crypto.PubkeyToAddress(s.Prv.PublicKey)
	for _, tee := range active.TeeIds {
		if tee == expectedTEE {
			continue
		}
		machineOwner, ownerErr := s.TeeMachineRegistry.GetTeeMachineOwner(nil, tee)
		machineExtension, extensionErr := s.TeeMachineRegistry.GetExtensionId(nil, tee)
		status, statusErr := s.TeeMachineRegistry.GetTeeMachineStatus(nil, tee)
		if ownerErr != nil || extensionErr != nil || statusErr != nil || machineOwner != owner ||
			machineExtension.Cmp(expectedExtensionID) != 0 || status != 2 {
			fccutils.FatalWithCause(errors.Errorf("refusing to retire unverified TEE %s owner=%s extension=%v status=%d errors=%v/%v/%v",
				tee, machineOwner, machineExtension, status, ownerErr, extensionErr, statusErr))
		}
		opts, optsErr := bind.NewKeyedTransactorWithChainID(s.Prv, s.ChainID)
		if optsErr != nil {
			fccutils.FatalWithCause(optsErr)
		}
		tx, banErr := s.TeeMachineRegistry.Ban(opts, tee)
		if banErr != nil {
			fccutils.FatalWithCause(errors.Errorf("ban obsolete TEE %s: %v", tee, banErr))
		}
		receipt, receiptErr := support.CheckTx(tx, s.ChainClient)
		if receiptErr != nil || receipt == nil || receipt.Status != 1 {
			status := uint64(0)
			if receipt != nil {
				status = receipt.Status
			}
			fccutils.FatalWithCause(errors.Errorf("obsolete TEE retirement failed tee=%s tx=%s status=%d err=%v",
				tee, tx.Hash(), status, receiptErr))
		}
		logger.Infof("STALE_TEE_RETIRED tee=%s tx=%s block=%d", tee, tx.Hash(), receipt.BlockNumber)
	}
	after, err := s.TeeMachineRegistry.GetActiveTeeMachines(nil, expectedExtensionID)
	if err != nil || len(after.TeeIds) != 1 || after.TeeIds[0] != expectedTEE {
		fccutils.FatalWithCause(errors.Errorf("TEE selection remains ambiguous after retirement: active=%v err=%v", after.TeeIds, err))
	}
}

func runInstructionReadinessGate(expectedTEE common.Address, expectedExtensionID *big.Int) {
	script := filepath.Join("..", "scripts", "fcc-ready-for-instruction.sh")
	command := exec.Command(script)
	command.Stdout = os.Stdout
	command.Stderr = os.Stderr
	command.Env = append(os.Environ(),
		"EXPECTED_TEE_ID="+expectedTEE.Hex(),
		"EXPECTED_EXTENSION_ID="+expectedExtensionID.String(),
	)
	if err := command.Run(); err != nil {
		fccutils.FatalWithCause(errors.Errorf("FCC instruction readiness gate failed: %v", err))
	}
}

type evaluationEvidence struct {
	ActionID common.Hash
	TxHash   common.Hash
	Result   evaluationResult
	RawData  []byte
	Log      string
}

func restoreExistingPolicy(s *support.Support, sender common.Address, proxy string, tee common.Address,
	artifactPath, expectedText, managerText, existingActionText string, ecdsaPub *ecdsa.PublicKey) {
	if !common.IsHexAddress(managerText) || len(expectedText) != 66 {
		fccutils.FatalWithCause(errors.New("valid -guardManager and -expectedPolicyCommitment are required"))
	}
	privateBytes, err := os.ReadFile(artifactPath)
	if err != nil {
		fccutils.FatalWithCause(errors.Errorf("reading private policy artifact: %s", err))
	}
	defer clear(privateBytes)
	var privatePolicy policy
	if err = json.Unmarshal(privateBytes, &privatePolicy); err != nil {
		fccutils.FatalWithCause(errors.Errorf("decoding private policy artifact: %s", err))
	}
	expected := common.HexToHash(expectedText)
	computed := mustPolicyCommitment(privatePolicy)
	if computed != expected {
		fccutils.FatalWithCause(errors.Errorf("restored policy commitment mismatch: computed=%s expected=%s", computed.Hex(), expected.Hex()))
	}
	manager := common.HexToAddress(managerText)
	selector := crypto.Keccak256([]byte("getGuard(bytes32)"))[:4]
	callData := append(append([]byte{}, selector...), privatePolicy.RuleID.Bytes()...)
	output, err := s.ChainClient.CallContract(context.Background(), ethereum.CallMsg{To: &manager, Data: callData}, nil)
	if err != nil || len(output) < 96 {
		fccutils.FatalWithCause(errors.Errorf("reading GuardManager commitment: len=%d err=%v", len(output), err))
	}
	onchain := common.BytesToHash(output[64:96])
	if onchain != expected {
		fccutils.FatalWithCause(errors.Errorf("GuardManager policy commitment mismatch: onchain=%s expected=%s", onchain.Hex(), expected.Hex()))
	}
	if privatePolicy.ExpiresAt <= uint64(time.Now().Unix()) {
		fccutils.FatalWithCause(errors.New("exact restored policy is already expired"))
	}
	var actionID, txHash common.Hash
	if existingActionText != "" {
		if len(existingActionText) != 66 || !strings.HasPrefix(existingActionText, "0x") {
			fccutils.FatalWithCause(errors.New("-restoreActionId must be a bytes32 hex value"))
		}
		actionID = common.HexToHash(existingActionText)
		logger.Infof("RESUMING_POLICY_RESTORE actionId=%s (no instruction submitted)", actionID.Hex())
	} else {
		ecPub := &ecies.PublicKey{X: ecdsaPub.X, Y: ecdsaPub.Y, Curve: ecies.DefaultCurve, Params: ecies.ECIES_AES128_SHA256}
		ciphertext, encryptErr := ecies.Encrypt(rand.Reader, ecPub, privateBytes, nil, nil)
		if encryptErr != nil {
			fccutils.FatalWithCause(errors.Errorf("encrypting restored policy: %s", encryptErr))
		}
		payload, _ := json.Marshal(map[string]any{"encryptedPolicy": ciphertext})
		clear(ciphertext)
		actionID, txHash, err = instrutils.SendCreatePolicy(s, sender, payload)
		clear(payload)
		if err != nil {
			fccutils.FatalWithCause(err)
		}
	}
	response := mustResult(proxy, actionID, tee, 1)
	var created createPolicyResponse
	if err = json.Unmarshal(response.Result.Data, &created); err != nil || !created.Accepted ||
		created.RuleID != privatePolicy.RuleID || created.PolicyCommitment != expected {
		fccutils.FatalWithCause(errors.Errorf("restored CREATE_POLICY acknowledgment mismatch: %v", err))
	}
	assertPrivateFieldsAbsent(response.Result.Data, privatePolicy)
	confirmLivePolicyCount(1)
	logger.Infof("POLICY_RESTORED ruleId=%s commitment=%s actionId=%s tx=%s signature=valid",
		privatePolicy.RuleID.Hex(), expected.Hex(), actionID.Hex(), txHash.Hex())
}

func confirmLivePolicyCount(expected int) {
	command := exec.Command("docker", "exec", "fcc-extension-redis-1", "wget", "-qO-",
		"http://fcc-extension-extension-tee-1:7702/state")
	output, err := command.Output()
	if err != nil {
		fccutils.FatalWithCause(errors.Errorf("read live extension state: %v", err))
	}
	var state struct {
		State struct {
			PolicyCount int `json:"policyCount"`
		} `json:"state"`
	}
	if err = json.Unmarshal(output, &state); err != nil || state.State.PolicyCount != expected {
		fccutils.FatalWithCause(errors.Errorf("unexpected live policyCount: got=%d want=%d decodeErr=%v",
			state.State.PolicyCount, expected, err))
	}
	logger.Infof("POLICY_COUNT_VERIFIED count=%d", expected)
}

// evaluateExistingSnapshot submits exactly one evaluation for an existing
// GuardManager snapshot. It never creates a policy and never accepts an event
// timestamp from the caller.
func evaluateExistingSnapshot(s *support.Support, sender common.Address, proxy string, tee common.Address,
	managerText, ruleText, eventText, artifactPath string) {
	if len(ruleText) != 66 || len(eventText) != 66 || !strings.HasPrefix(ruleText, "0x") || !strings.HasPrefix(eventText, "0x") {
		fccutils.FatalWithCause(errors.New("-ruleId and -eventHash must be bytes32 hex values"))
	}
	if !common.IsHexAddress(managerText) || artifactPath == "" {
		fccutils.FatalWithCause(errors.New("valid -guardManager and -resultArtifact are required"))
	}
	ruleID, eventHash := common.HexToHash(ruleText), common.HexToHash(eventText)
	manager := common.HexToAddress(managerText)
	snapshot, consumed := readGuardManagerSnapshot(s, manager, eventHash)
	if snapshot.RuleID != ruleID || snapshot.EventValueUSD18.Sign() <= 0 || snapshot.PriceUSD18.Sign() <= 0 || snapshot.PreparedAt == 0 {
		fccutils.FatalWithCause(errors.New("GuardManager snapshot is missing or does not match ruleId"))
	}
	if consumed {
		fccutils.FatalWithCause(errors.New("GuardManager event is already consumed"))
	}
	value := snapshot.EventValueUSD18
	nonce := uint64(time.Now().UnixNano())
	submittedAfter := uint64(time.Now().Add(-2 * time.Minute).Unix())
	payload, err := json.Marshal(map[string]any{
		"ruleId": ruleID, "eventHash": eventHash, "nonce": nonce,
	})
	if err != nil {
		fccutils.FatalWithCause(err)
	}
	actionID, txHash, err := instrutils.SendEvaluateGuard(s, sender, payload)
	clear(payload)
	if err != nil {
		fccutils.FatalWithCause(err)
	}
	response := mustResult(proxy, actionID, tee, 1)
	if len(response.Result.Data) != decision.EncodedLength {
		fccutils.FatalWithCause(errors.Errorf("invalid FCCDecision ABI length: got %d, want %d", len(response.Result.Data), decision.EncodedLength))
	}
	decoded, err := decision.Decode(response.Result.Data)
	if err != nil {
		fccutils.FatalWithCause(err)
	}
	if decoded.Domain != resultDomain || decoded.RuleID != ruleID || decoded.EventHash != eventHash ||
		decoded.EventValueUSD18.Cmp(value) != 0 || decoded.Nonce.Cmp(new(big.Int).SetUint64(nonce)) != 0 {
		fccutils.FatalWithCause(errors.New("evaluation result context mismatch"))
	}
	if !decoded.Triggered || decoded.ProtectBPS != expectedProtectBPS || decoded.ScheduleID != expectedScheduleID {
		fccutils.FatalWithCause(errors.Errorf("expected triggered 70%% schedule-1 decision, got %+v", decoded))
	}
	expectedProtected := new(big.Int).Mul(value, big.NewInt(int64(expectedProtectBPS)))
	expectedProtected.Div(expectedProtected, big.NewInt(10_000))
	if decoded.ProtectedUSD18.Cmp(expectedProtected) != 0 {
		fccutils.FatalWithCause(errors.Errorf("protected amount mismatch: got %s want %s", decoded.ProtectedUSD18, expectedProtected))
	}
	if decoded.EvaluatedAt < submittedAfter || decoded.EvaluatedAt > uint64(time.Now().Add(2*time.Minute).Unix()) ||
		decoded.ResultExpiry <= decoded.EvaluatedAt || decoded.ResultExpiry-decoded.EvaluatedAt > expectedDecisionLifetime {
		fccutils.FatalWithCause(errors.New("invalid trusted evaluation time/result lifetime"))
	}
	resultHash := mustEvaluationHash(decoded)
	artifact := map[string]any{
		"chainId": chainID, "tee": tee.Hex(), "caller": sender.Hex(),
		"actionId": actionID.Hex(), "transactionHash": txHash.Hex(),
		"submissionTag": response.Result.SubmissionTag, "status": response.Result.Status,
		"data":      "0x" + common.Bytes2Hex(response.Result.Data),
		"signature": "0x" + common.Bytes2Hex(response.Signature), "resultHash": resultHash.Hex(),
		"decision": map[string]any{
			"domain": decoded.Domain.Hex(), "ruleId": decoded.RuleID.Hex(), "eventHash": decoded.EventHash.Hex(),
			"triggered": decoded.Triggered, "protectedUsd18": decoded.ProtectedUSD18.String(),
			"protectBps": decoded.ProtectBPS, "scheduleId": decoded.ScheduleID,
			"eventValueUsd18": decoded.EventValueUSD18.String(), "evaluatedAt": decoded.EvaluatedAt,
			"nonce": decoded.Nonce.String(), "resultExpiry": decoded.ResultExpiry,
		},
	}
	encoded, err := json.MarshalIndent(artifact, "", "  ")
	if err != nil {
		fccutils.FatalWithCause(err)
	}
	if err = os.MkdirAll(filepath.Dir(artifactPath), 0700); err != nil {
		fccutils.FatalWithCause(err)
	}
	if err = os.WriteFile(artifactPath, encoded, 0600); err != nil {
		fccutils.FatalWithCause(err)
	}
	logger.Infof("PHASE63_EVALUATION_OK ruleId=%s eventHash=%s eventValueUsd18=%s protectedUsd18=%s nonce=%d evaluatedAt=%d resultExpiry=%d lifetime=%d dataBytes=%d domain=%s actionId=%s tx=%s resultHash=%s signature=valid artifact=%s",
		ruleID.Hex(), eventHash.Hex(), value, decoded.ProtectedUSD18, nonce, decoded.EvaluatedAt, decoded.ResultExpiry,
		decoded.ResultExpiry-decoded.EvaluatedAt, len(response.Result.Data), decoded.Domain.Hex(), actionID.Hex(), txHash.Hex(), resultHash.Hex(), artifactPath)
}

type guardManagerSnapshot struct {
	RuleID           common.Hash
	EventValueUSD18  *big.Int
	PriceUSD18       *big.Int
	PriceTimestamp   uint64
	PaymentTimestamp uint64
	PreparedAt       uint64
}

func readGuardManagerSnapshot(s *support.Support, manager common.Address, eventHash common.Hash) (guardManagerSnapshot, bool) {
	code, err := s.ChainClient.CodeAt(context.Background(), manager, nil)
	if err != nil || len(code) == 0 {
		fccutils.FatalWithCause(errors.Errorf("GuardManager bytecode unavailable: %v", err))
	}
	argument, _ := (abi.Arguments{{Type: bytes32Type}}).Pack(eventHash)
	call := func(signature string) []byte {
		selector := crypto.Keccak256([]byte(signature))[:4]
		data := append(append([]byte{}, selector...), argument...)
		output, callErr := s.ChainClient.CallContract(context.Background(), ethereum.CallMsg{To: &manager, Data: data}, nil)
		if callErr != nil {
			fccutils.FatalWithCause(errors.Errorf("GuardManager %s call failed: %v", signature, callErr))
		}
		return output
	}
	out := call("getEvaluationSnapshot(bytes32)")
	if len(out) != 192 {
		fccutils.FatalWithCause(errors.Errorf("invalid GuardManager snapshot encoding length: %d", len(out)))
	}
	consumedOut := call("isEventConsumed(bytes32)")
	if len(consumedOut) != 32 {
		fccutils.FatalWithCause(errors.Errorf("invalid GuardManager consumption encoding length: %d", len(consumedOut)))
	}
	return guardManagerSnapshot{
		RuleID: common.BytesToHash(out[0:32]), EventValueUSD18: new(big.Int).SetBytes(out[32:64]),
		PriceUSD18: new(big.Int).SetBytes(out[64:96]), PriceTimestamp: new(big.Int).SetBytes(out[96:128]).Uint64(),
		PaymentTimestamp: new(big.Int).SetBytes(out[128:160]).Uint64(), PreparedAt: new(big.Int).SetBytes(out[160:192]).Uint64(),
	}, new(big.Int).SetBytes(consumedOut).Sign() != 0
}

func sendEvaluation(s *support.Support, sender common.Address, proxy string, tee common.Address, ruleID, eventHash common.Hash, value string, nonce uint64, expectedStatus uint8) evaluationEvidence {
	submittedAfter := uint64(time.Now().Add(-2 * time.Minute).Unix())
	payload, _ := json.Marshal(map[string]any{"ruleId": ruleID, "eventHash": eventHash, "nonce": nonce})
	actionID, txHash, err := instrutils.SendEvaluateGuard(s, sender, payload)
	if err != nil {
		fccutils.FatalWithCause(err)
	}
	response := mustResult(proxy, actionID, tee, expectedStatus)
	evidence := evaluationEvidence{ActionID: actionID, TxHash: txHash, RawData: response.Result.Data, Log: response.Result.Log}
	if expectedStatus == 1 {
		if len(response.Result.Data) != decision.EncodedLength {
			fccutils.FatalWithCause(errors.Errorf("invalid FCCDecision ABI length: got %d, want %d", len(response.Result.Data), decision.EncodedLength))
		}
		decoded, err := decision.Decode(response.Result.Data)
		if err != nil {
			fccutils.FatalWithCause(errors.Errorf("decode evaluation result: %s", err))
		}
		evidence.Result = decoded
		expectedValue := uintValue(value)
		if evidence.Result.Domain != resultDomain || evidence.Result.RuleID != ruleID ||
			evidence.Result.EventHash != eventHash || evidence.Result.EventValueUSD18.Cmp(expectedValue) != 0 ||
			evidence.Result.Nonce.Cmp(new(big.Int).SetUint64(nonce)) != 0 {
			fccutils.FatalWithCause(errors.New("evaluation result context mismatch"))
		}
		if evidence.Result.EvaluatedAt < submittedAfter || evidence.Result.EvaluatedAt > uint64(time.Now().Add(2*time.Minute).Unix()) {
			fccutils.FatalWithCause(errors.Errorf("evaluatedAt is not a current trusted FCC time: %d", evidence.Result.EvaluatedAt))
		}
		if evidence.Result.ResultExpiry <= evidence.Result.EvaluatedAt ||
			evidence.Result.ResultExpiry-evidence.Result.EvaluatedAt > expectedDecisionLifetime {
			fccutils.FatalWithCause(errors.Errorf("invalid FCC decision lifetime: evaluatedAt=%d resultExpiry=%d",
				evidence.Result.EvaluatedAt, evidence.Result.ResultExpiry))
		}
	}
	return evidence
}

func mustResult(proxy string, actionID common.Hash, tee common.Address, expectedStatus uint8) *teetypes.ActionResponse {
	response, err := fccutils.ActionResult(proxy, actionID)
	if err != nil {
		fccutils.FatalWithCause(err)
	}
	if response.Result.ID != actionID || response.Result.Status != expectedStatus {
		fccutils.FatalWithCause(errors.Errorf("unexpected ActionResult: id=%s status=%d log=%q", response.Result.ID, response.Result.Status, response.Result.Log))
	}
	inner := common.BytesToHash(response.Result.Hash())
	payload, err := csigning.NewPayload(csigning.TEEActionResult, chainID, inner).Hash()
	if err != nil {
		fccutils.FatalWithCause(err)
	}
	if err := teeutils.VerifySignature(payload[:], response.Signature, tee); err != nil {
		fccutils.FatalWithCause(errors.Errorf("invalid TEE ActionResult signature: %s", err))
	}
	return response
}

func randomHash() common.Hash {
	var value common.Hash
	if _, err := rand.Read(value[:]); err != nil {
		fccutils.FatalWithCause(err)
	}
	return value
}

func uintValue(value string) *big.Int {
	parsed, ok := new(big.Int).SetString(value, 10)
	if !ok {
		fccutils.FatalWithCause(errors.Errorf("invalid uint256 fixture %q", value))
	}
	return parsed
}

func mustPolicyCommitment(p policy) common.Hash {
	encoded, err := (abi.Arguments{{Type: bytes32Type}, {Type: bytes32Type}, {Type: uint256Type},
		{Type: uint16Type}, {Type: uint32Type}, {Type: uint256Type}, {Type: uint64Type}, {Type: uint64Type}}).
		Pack(policyDomain, p.RuleID, uintValue(p.ThresholdUSD18), p.ProtectBPS, p.ScheduleID,
			uintValue(p.MaxPerEventUSD18), p.CooldownSeconds, p.ExpiresAt)
	if err != nil {
		fccutils.FatalWithCause(err)
	}
	return crypto.Keccak256Hash(encoded)
}

func mustEvaluationHash(r evaluationResult) common.Hash {
	result, err := decision.ResultHash(new(big.Int).SetUint64(chainID), r)
	if err != nil {
		fccutils.FatalWithCause(err)
	}
	return result
}

func assertPrivateFieldsAbsent(data []byte, p policy) {
	for name, value := range map[string]string{"thresholdUsd18": p.ThresholdUSD18, "maxPerEventUsd18": p.MaxPerEventUSD18,
		"cooldownSeconds": fmt.Sprint(p.CooldownSeconds), "expiresAt": fmt.Sprint(p.ExpiresAt)} {
		if strings.Contains(string(data), value) {
			fccutils.FatalWithCause(errors.Errorf("private field %s leaked in public result", name))
		}
	}
}

func assertEvaluationPrivateFieldsAbsent(data []byte, p policy) {
	assertPrivateFieldsAbsent(data, p)
	if strings.Contains(string(data), "thresholdUsd18") || strings.Contains(string(data), "maxPerEventUsd18") ||
		strings.Contains(string(data), "cooldownSeconds") || strings.Contains(string(data), "expiresAt") {
		fccutils.FatalWithCause(errors.New("private policy field name leaked in public evaluation result"))
	}
}

func init() {
	// Prevent accidental policy injection through the legacy environment path.
	os.Unsetenv("AVERLOCK_ENCRYPTED_POLICY_BASE64")
}
