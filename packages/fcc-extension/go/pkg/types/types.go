// Package types defines AVERLOCK's private policy and public result wire types.
package types

import "github.com/ethereum/go-ethereum/common"

// Policy is decrypted only inside the extension. USD amounts are unsigned decimal
// strings so the JSON wire format can represent the full Solidity uint256 range.
type Policy struct {
	RuleID           common.Hash `json:"ruleId"`
	ThresholdUSD18   string      `json:"thresholdUsd18"`
	ProtectBPS       uint16      `json:"protectBps"`
	ScheduleID       uint32      `json:"scheduleId"`
	MaxPerEventUSD18 string      `json:"maxPerEventUsd18"`
	CooldownSeconds  uint64      `json:"cooldownSeconds"`
	ExpiresAt        uint64      `json:"expiresAt"`
}

// CreatePolicyRequest contains ciphertext only. tee-node decrypts it through its
// private sign-port API before the Policy JSON is decoded.
type CreatePolicyRequest struct {
	EncryptedPolicy []byte `json:"encryptedPolicy"`
}

type CreatePolicyResponse struct {
	RuleID           common.Hash `json:"ruleId"`
	Accepted         bool        `json:"accepted"`
	PolicyCommitment common.Hash `json:"policyCommitment"`
}

type EvaluateGuardRequest struct {
	RuleID    common.Hash `json:"ruleId"`
	EventHash common.Hash `json:"eventHash"`
	Nonce     uint64      `json:"nonce"`
}

// EvaluationResult intentionally excludes threshold, max-per-event, cooldown,
// expiry, and ciphertext. ProtectBPS and ScheduleID are disclosed only when a
// trigger needs future onchain execution.
type EvaluationResult struct {
	RuleID          common.Hash `json:"ruleId"`
	EventHash       common.Hash `json:"eventHash"`
	Triggered       bool        `json:"triggered"`
	ProtectedUSD18  string      `json:"protectedUsd18,omitempty"`
	ProtectBPS      uint16      `json:"protectBps,omitempty"`
	ScheduleID      uint32      `json:"scheduleId,omitempty"`
	EventValueUSD18 string      `json:"eventValueUsd18,omitempty"`
	EvaluatedAt     uint64      `json:"evaluatedAt"`
	Nonce           uint64      `json:"nonce"`
	ResultExpiry    uint64      `json:"resultExpiry,omitempty"`
	ResultHash      common.Hash `json:"resultHash"`
}

type State struct {
	PolicyCount        int `json:"policyCount"`
	EvaluationCount    int `json:"evaluationCount"`
	SuccessfulTriggers int `json:"successfulTriggers"`
}

type StateResponse struct {
	StateVersion common.Hash `json:"stateVersion"`
	State        State       `json:"state"`
}
