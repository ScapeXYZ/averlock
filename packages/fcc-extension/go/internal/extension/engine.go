package extension

import (
	"fmt"
	"math/big"

	"extension-scaffold/internal/config"
	"extension-scaffold/pkg/decision"
	guardtypes "extension-scaffold/pkg/types"

	"github.com/ethereum/go-ethereum/accounts/abi"
	"github.com/ethereum/go-ethereum/common"
	"github.com/ethereum/go-ethereum/crypto"
)

var (
	policyDomain   = crypto.Keccak256Hash([]byte("AVERLOCK_POLICY_V1"))
	uint256Type, _ = abi.NewType("uint256", "", nil)
	uint16Type, _  = abi.NewType("uint16", "", nil)
	uint32Type, _  = abi.NewType("uint32", "", nil)
	uint64Type, _  = abi.NewType("uint64", "", nil)
	bytes32Type, _ = abi.NewType("bytes32", "", nil)
)

type normalizedPolicy struct {
	RuleID           common.Hash
	ThresholdUSD18   *big.Int
	ProtectBPS       uint16
	ScheduleID       uint32
	MaxPerEventUSD18 *big.Int
	CooldownSeconds  uint64
	ExpiresAt        uint64
}

type policyState struct {
	Policy         normalizedPolicy
	Commitment     common.Hash
	LastTriggered  uint64
	Authorizations map[common.Hash]*eventAuthorization
	UsedNonces     map[uint64]struct{}
}

// eventAuthorization freezes the first decision for an economic event. A
// later authorization may only refresh its signing window and nonce.
type eventAuthorization struct {
	EventValueUSD18 *big.Int
	Triggered       bool
	ProtectedUSD18  *big.Int
	ProtectBPS      uint16
	ScheduleID      uint32
	LastExpiry      uint64
}

func normalizePolicy(policy guardtypes.Policy) (normalizedPolicy, error) {
	if policy.RuleID == (common.Hash{}) {
		return normalizedPolicy{}, fmt.Errorf("ruleId must not be zero")
	}
	threshold, err := parseUint256(policy.ThresholdUSD18, false)
	if err != nil {
		return normalizedPolicy{}, fmt.Errorf("thresholdUsd18: %w", err)
	}
	if policy.ProtectBPS == 0 || policy.ProtectBPS > 10_000 {
		return normalizedPolicy{}, fmt.Errorf("protectBps must be between 1 and 10000")
	}
	if policy.ScheduleID != config.ScheduleThirtyDayLinear {
		return normalizedPolicy{}, fmt.Errorf("unsupported scheduleId %d", policy.ScheduleID)
	}
	maxValue, err := parseUint256(policy.MaxPerEventUSD18, true)
	if err != nil {
		return normalizedPolicy{}, fmt.Errorf("maxPerEventUsd18: %w", err)
	}
	if maxValue.Sign() > 0 && maxValue.Cmp(threshold) < 0 {
		return normalizedPolicy{}, fmt.Errorf("maxPerEventUsd18 must be zero or at least thresholdUsd18")
	}
	if policy.ExpiresAt == 0 {
		return normalizedPolicy{}, fmt.Errorf("expiresAt must be non-zero")
	}
	return normalizedPolicy{
		RuleID: policy.RuleID, ThresholdUSD18: threshold, ProtectBPS: policy.ProtectBPS,
		ScheduleID: policy.ScheduleID, MaxPerEventUSD18: maxValue,
		CooldownSeconds: policy.CooldownSeconds, ExpiresAt: policy.ExpiresAt,
	}, nil
}

func parseUint256(value string, allowZero bool) (*big.Int, error) {
	if value == "" {
		return nil, fmt.Errorf("must be an unsigned decimal string")
	}
	parsed, ok := new(big.Int).SetString(value, 10)
	if !ok || parsed.Sign() < 0 || parsed.BitLen() > 256 {
		return nil, fmt.Errorf("must fit uint256")
	}
	if !allowZero && parsed.Sign() == 0 {
		return nil, fmt.Errorf("must be greater than zero")
	}
	return parsed, nil
}

func policyCommitment(policy normalizedPolicy) (common.Hash, error) {
	encoded, err := (abi.Arguments{
		{Type: bytes32Type}, {Type: bytes32Type}, {Type: uint256Type},
		{Type: uint16Type}, {Type: uint32Type}, {Type: uint256Type},
		{Type: uint64Type}, {Type: uint64Type},
	}).Pack(policyDomain, policy.RuleID, policy.ThresholdUSD18, policy.ProtectBPS,
		policy.ScheduleID, policy.MaxPerEventUSD18, policy.CooldownSeconds, policy.ExpiresAt)
	if err != nil {
		return common.Hash{}, fmt.Errorf("encoding policy commitment: %w", err)
	}
	return crypto.Keccak256Hash(encoded), nil
}

func evaluationResultHash(result guardtypes.EvaluationResult) (common.Hash, error) {
	protected, err := parseUint256(defaultZero(result.ProtectedUSD18), true)
	if err != nil {
		return common.Hash{}, err
	}
	eventValue, err := parseUint256(defaultZero(result.EventValueUSD18), true)
	if err != nil {
		return common.Hash{}, err
	}
	return decision.ResultHash(new(big.Int).SetUint64(config.Coston2ChainID), decision.FCCDecision{
		Domain: decision.Domain, RuleID: result.RuleID, EventHash: result.EventHash,
		Triggered: result.Triggered, ProtectedUSD18: protected, ProtectBPS: result.ProtectBPS,
		ScheduleID: result.ScheduleID, EventValueUSD18: eventValue, EvaluatedAt: result.EvaluatedAt,
		Nonce: new(big.Int).SetUint64(result.Nonce), ResultExpiry: result.ResultExpiry,
	})
}

func defaultZero(value string) string {
	if value == "" {
		return "0"
	}
	return value
}
