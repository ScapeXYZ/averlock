// Package decision is the canonical AVERLOCK FCC decision ABI codec.
package decision

import (
	"bytes"
	"fmt"
	"math/big"

	"github.com/ethereum/go-ethereum/accounts/abi"
	"github.com/ethereum/go-ethereum/common"
	"github.com/ethereum/go-ethereum/crypto"
)

const EncodedLength = 11 * 32

var (
	Domain         = crypto.Keccak256Hash([]byte("AVERLOCK_GUARD_RESULT_V2"))
	bytes32Type, _ = abi.NewType("bytes32", "", nil)
	boolType, _    = abi.NewType("bool", "", nil)
	uint256Type, _ = abi.NewType("uint256", "", nil)
	uint16Type, _  = abi.NewType("uint16", "", nil)
	uint32Type, _  = abi.NewType("uint32", "", nil)
	uint64Type, _  = abi.NewType("uint64", "", nil)
	decisionABI    = abi.Arguments{{Type: bytes32Type}, {Type: bytes32Type}, {Type: bytes32Type},
		{Type: boolType}, {Type: uint256Type}, {Type: uint16Type}, {Type: uint32Type},
		{Type: uint256Type}, {Type: uint64Type}, {Type: uint256Type}, {Type: uint64Type}}
	hashABI = abi.Arguments{{Type: bytes32Type}, {Type: uint256Type}, {Type: bytes32Type},
		{Type: bytes32Type}, {Type: boolType}, {Type: uint256Type}, {Type: uint16Type},
		{Type: uint32Type}, {Type: uint256Type}, {Type: uint64Type}, {Type: uint256Type},
		{Type: uint64Type}}
)

// FCCDecision field order exactly matches FCCDecisionCodec.Decision in Solidity.
type FCCDecision struct {
	Domain          common.Hash
	RuleID          common.Hash
	EventHash       common.Hash
	Triggered       bool
	ProtectedUSD18  *big.Int
	ProtectBPS      uint16
	ScheduleID      uint32
	EventValueUSD18 *big.Int
	EvaluatedAt     uint64
	Nonce           *big.Int
	ResultExpiry    uint64
}

func (d FCCDecision) Validate() error {
	if d.Domain != Domain {
		return fmt.Errorf("unexpected decision domain %s", d.Domain)
	}
	for name, value := range map[string]*big.Int{
		"protectedUsd18": d.ProtectedUSD18, "eventValueUsd18": d.EventValueUSD18, "nonce": d.Nonce,
	} {
		if value == nil || value.Sign() < 0 || value.BitLen() > 256 {
			return fmt.Errorf("%s must fit uint256", name)
		}
	}
	return nil
}

func Encode(d FCCDecision) ([]byte, error) {
	if err := d.Validate(); err != nil {
		return nil, err
	}
	return decisionABI.Pack(d.Domain, d.RuleID, d.EventHash, d.Triggered, d.ProtectedUSD18,
		d.ProtectBPS, d.ScheduleID, d.EventValueUSD18, d.EvaluatedAt, d.Nonce, d.ResultExpiry)
}

func Decode(data []byte) (FCCDecision, error) {
	if len(data) != EncodedLength {
		return FCCDecision{}, fmt.Errorf("invalid decision ABI length: got %d, want %d", len(data), EncodedLength)
	}
	values, err := decisionABI.Unpack(data)
	if err != nil {
		return FCCDecision{}, fmt.Errorf("decode decision ABI: %w", err)
	}
	d := FCCDecision{
		Domain: values[0].([32]byte), RuleID: values[1].([32]byte), EventHash: values[2].([32]byte),
		Triggered: values[3].(bool), ProtectedUSD18: values[4].(*big.Int), ProtectBPS: values[5].(uint16),
		ScheduleID: values[6].(uint32), EventValueUSD18: values[7].(*big.Int), EvaluatedAt: values[8].(uint64),
		Nonce: values[9].(*big.Int), ResultExpiry: values[10].(uint64),
	}
	if err := d.Validate(); err != nil {
		return FCCDecision{}, err
	}
	canonical, err := Encode(d)
	if err != nil {
		return FCCDecision{}, err
	}
	if !bytes.Equal(canonical, data) {
		return FCCDecision{}, fmt.Errorf("non-canonical decision ABI")
	}
	return d, nil
}

// ResultHash binds the V2 semantic domain, chain ID, and all decision fields.
func ResultHash(chainID *big.Int, d FCCDecision) (common.Hash, error) {
	if chainID == nil || chainID.Sign() <= 0 || chainID.BitLen() > 256 {
		return common.Hash{}, fmt.Errorf("chainId must fit positive uint256")
	}
	if err := d.Validate(); err != nil {
		return common.Hash{}, err
	}
	encoded, err := hashABI.Pack(d.Domain, chainID, d.RuleID, d.EventHash, d.Triggered,
		d.ProtectedUSD18, d.ProtectBPS, d.ScheduleID, d.EventValueUSD18, d.EvaluatedAt, d.Nonce, d.ResultExpiry)
	if err != nil {
		return common.Hash{}, err
	}
	return crypto.Keccak256Hash(encoded), nil
}
