package main

import (
	"bytes"
	"crypto/ecdsa"
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io"
	"math/big"
	"os"
	"strings"

	"extension-scaffold/pkg/decision"
	guardtypes "extension-scaffold/pkg/types"

	"github.com/ethereum/go-ethereum/accounts/abi"
	"github.com/ethereum/go-ethereum/common"
	"github.com/ethereum/go-ethereum/crypto"
	"github.com/ethereum/go-ethereum/crypto/ecies"
	csigning "github.com/flare-foundation/go-flare-common/pkg/signing"
	teetypes "github.com/flare-foundation/tee-node/pkg/types"
	teeutils "github.com/flare-foundation/tee-node/pkg/utils"
)

const chainID = uint64(114)

var (
	bytes32Type, _ = abi.NewType("bytes32", "", nil)
	uint256Type, _ = abi.NewType("uint256", "", nil)
	uint16Type, _  = abi.NewType("uint16", "", nil)
	uint32Type, _  = abi.NewType("uint32", "", nil)
	uint64Type, _  = abi.NewType("uint64", "", nil)
	policyDomain   = crypto.Keccak256Hash([]byte("AVERLOCK_POLICY_V1"))
)

type publicKey struct {
	X string `json:"x"`
	Y string `json:"y"`
}
type prepareInput struct {
	Policy    guardtypes.Policy `json:"policy"`
	PublicKey publicKey         `json:"publicKey"`
}
type verifyInput struct {
	Response         teetypes.ActionResponse `json:"response"`
	ExpectedTEE      common.Address          `json:"expectedTee"`
	RuleID           common.Hash             `json:"ruleId"`
	PolicyCommitment common.Hash             `json:"policyCommitment"`
}
type verifyEvaluationInput struct {
	Response        teetypes.ActionResponse `json:"response"`
	ExpectedTEE     common.Address          `json:"expectedTee"`
	RuleID          common.Hash             `json:"ruleId"`
	EventHash       common.Hash             `json:"eventHash"`
	EventValueUSD18 string                  `json:"eventValueUsd18"`
	PreparedAt      uint64                  `json:"preparedAt"`
	Nonce           string                  `json:"nonce"`
}
type createPolicyResponse struct {
	RuleID           common.Hash `json:"ruleId"`
	Accepted         bool        `json:"accepted"`
	PolicyCommitment common.Hash `json:"policyCommitment"`
}

func main() {
	if len(os.Args) != 2 {
		fail("usage: policy-app-helper prepare|verify|verify-evaluation")
	}
	input, err := io.ReadAll(io.LimitReader(os.Stdin, 64<<10))
	if err != nil {
		fail("read stdin: %v", err)
	}
	defer clear(input)
	switch os.Args[1] {
	case "prepare":
		prepare(input)
	case "verify":
		verify(input)
	case "verify-evaluation":
		verifyEvaluation(input)
	default:
		fail("unknown mode")
	}
}

func verifyEvaluation(input []byte) {
	var request verifyEvaluationInput
	if err := strictJSON(input, &request); err != nil {
		fail("invalid input: %v", err)
	}
	r := request.Response
	if r.Result.Status != 1 || r.Result.ID == (common.Hash{}) {
		fail("ActionResult is not successful")
	}
	inner := common.BytesToHash(r.Result.Hash())
	payload, err := csigning.NewPayload(csigning.TEEActionResult, chainID, inner).Hash()
	if err != nil {
		fail("signature payload: %v", err)
	}
	if err := teeutils.VerifySignature(payload[:], r.Signature, request.ExpectedTEE); err != nil {
		fail("invalid ActionResult signature: %v", err)
	}
	d, err := decision.Decode(r.Result.Data)
	if err != nil {
		fail("invalid FCCDecision: %v", err)
	}
	expectedValue := uintValue(request.EventValueUSD18, false)
	expectedNonce := uintValue(request.Nonce, true)
	if d.RuleID != request.RuleID || d.EventHash != request.EventHash || d.EventValueUSD18.Cmp(expectedValue) != 0 || d.Nonce.Cmp(expectedNonce) != 0 {
		fail("evaluation result binding mismatch")
	}
	if d.EvaluatedAt < request.PreparedAt || d.ResultExpiry <= d.EvaluatedAt || d.ResultExpiry-d.EvaluatedAt > 600 {
		fail("invalid evaluation time window")
	}
	resultHash, err := decision.ResultHash(new(big.Int).SetUint64(chainID), d)
	if err != nil {
		fail("result hash: %v", err)
	}
	write(map[string]any{"signatureValid": true, "actionId": r.Result.ID, "submissionTag": r.Result.SubmissionTag,
		"status": r.Result.Status, "data": "0x" + hex.EncodeToString(r.Result.Data), "signature": "0x" + hex.EncodeToString(r.Signature), "resultHash": resultHash,
		"decision": map[string]any{"domain": d.Domain, "ruleId": d.RuleID, "eventHash": d.EventHash, "triggered": d.Triggered,
			"protectedUsd18": d.ProtectedUSD18.String(), "protectBps": d.ProtectBPS, "scheduleId": d.ScheduleID,
			"eventValueUsd18": d.EventValueUSD18.String(), "evaluatedAt": d.EvaluatedAt, "nonce": d.Nonce.String(), "resultExpiry": d.ResultExpiry},
	})
}

func prepare(input []byte) {
	var request prepareInput
	if err := strictJSON(input, &request); err != nil {
		fail("invalid input: %v", err)
	}
	p := request.Policy
	threshold := uintValue(p.ThresholdUSD18, false)
	maximum := uintValue(p.MaxPerEventUSD18, true)
	if p.RuleID == (common.Hash{}) {
		fail("ruleId is zero")
	}
	if p.ProtectBPS == 0 || p.ProtectBPS > 10_000 {
		fail("protectBps out of range")
	}
	if p.ScheduleID != 1 {
		fail("unsupported scheduleId")
	}
	if maximum.Sign() > 0 && maximum.Cmp(threshold) < 0 {
		fail("maximum is below threshold")
	}
	if p.ExpiresAt == 0 {
		fail("expiresAt is zero")
	}
	commitmentBytes, err := (abi.Arguments{{Type: bytes32Type}, {Type: bytes32Type}, {Type: uint256Type}, {Type: uint16Type}, {Type: uint32Type}, {Type: uint256Type}, {Type: uint64Type}, {Type: uint64Type}}).Pack(policyDomain, p.RuleID, threshold, p.ProtectBPS, p.ScheduleID, maximum, p.CooldownSeconds, p.ExpiresAt)
	if err != nil {
		fail("commitment encoding: %v", err)
	}
	commitment := crypto.Keccak256Hash(commitmentBytes)
	plain, err := json.Marshal(p)
	if err != nil {
		fail("policy encoding: %v", err)
	}
	defer clear(plain)
	pub := parsePublicKey(request.PublicKey)
	ecPub := &ecies.PublicKey{X: pub.X, Y: pub.Y, Curve: ecies.DefaultCurve, Params: ecies.ECIES_AES128_SHA256}
	ciphertext, err := ecies.Encrypt(rand.Reader, ecPub, plain, nil, nil)
	if err != nil {
		fail("ECIES encryption: %v", err)
	}
	defer clear(ciphertext)
	envelope, err := json.Marshal(map[string]any{"encryptedPolicy": ciphertext})
	if err != nil {
		fail("envelope encoding: %v", err)
	}
	defer clear(envelope)
	write(map[string]any{"ruleId": p.RuleID, "policyCommitment": commitment, "encryptedEnvelope": "0x" + hex.EncodeToString(envelope)})
}

func verify(input []byte) {
	var request verifyInput
	if err := strictJSON(input, &request); err != nil {
		fail("invalid input: %v", err)
	}
	r := request.Response
	if r.Result.Status != 1 || r.Result.ID == (common.Hash{}) {
		fail("ActionResult is not successful")
	}
	inner := common.BytesToHash(r.Result.Hash())
	payload, err := csigning.NewPayload(csigning.TEEActionResult, chainID, inner).Hash()
	if err != nil {
		fail("signature payload: %v", err)
	}
	if err := teeutils.VerifySignature(payload[:], r.Signature, request.ExpectedTEE); err != nil {
		fail("invalid ActionResult signature: %v", err)
	}
	var result createPolicyResponse
	if err := json.Unmarshal(r.Result.Data, &result); err != nil {
		fail("invalid CREATE_POLICY result: %v", err)
	}
	if !result.Accepted || result.RuleID != request.RuleID || result.PolicyCommitment != request.PolicyCommitment {
		fail("CREATE_POLICY result binding mismatch")
	}
	write(map[string]any{"accepted": true, "ruleId": result.RuleID, "policyCommitment": result.PolicyCommitment, "actionId": r.Result.ID, "signatureValid": true})
}

func strictJSON(data []byte, target any) error {
	d := json.NewDecoder(bytes.NewReader(data))
	d.DisallowUnknownFields()
	return d.Decode(target)
}
func uintValue(value string, allowZero bool) *big.Int {
	parsed, ok := new(big.Int).SetString(value, 10)
	if !ok || parsed.Sign() < 0 || parsed.BitLen() > 256 || (!allowZero && parsed.Sign() == 0) {
		fail("invalid uint256")
	}
	return parsed
}
func parsePublicKey(key publicKey) *ecdsa.PublicKey {
	x, okX := new(big.Int).SetString(strings.TrimPrefix(key.X, "0x"), 16)
	y, okY := new(big.Int).SetString(strings.TrimPrefix(key.Y, "0x"), 16)
	if !okX || !okY || !crypto.S256().IsOnCurve(x, y) {
		fail("invalid TEE public key")
	}
	return &ecdsa.PublicKey{Curve: crypto.S256(), X: x, Y: y}
}
func write(value any) {
	if err := json.NewEncoder(os.Stdout).Encode(value); err != nil {
		fail("encode output: %v", err)
	}
}
func fail(format string, args ...any) { fmt.Fprintf(os.Stderr, format+"\n", args...); os.Exit(1) }
