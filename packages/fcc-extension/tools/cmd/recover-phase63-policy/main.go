package main

import (
	"encoding/json"
	"fmt"
	"math/big"
	"os"
	"path/filepath"

	"github.com/ethereum/go-ethereum/accounts/abi"
	"github.com/ethereum/go-ethereum/common"
	"github.com/ethereum/go-ethereum/crypto"
)

const (
	targetText = "0xc0233498cec668b66e90044ec8c8844b3693b34d2bb8e6ae82d3af182c36850c"
	ruleText   = "0x2a3a9591def2b67120f829c342d002de5e2def49ac0f4044a6be143071489400"
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

func main() {
	bytes32Type, _ := abi.NewType("bytes32", "", nil)
	uint256Type, _ := abi.NewType("uint256", "", nil)
	uint16Type, _ := abi.NewType("uint16", "", nil)
	uint32Type, _ := abi.NewType("uint32", "", nil)
	uint64Type, _ := abi.NewType("uint64", "", nil)
	args := abi.Arguments{{Type: bytes32Type}, {Type: bytes32Type}, {Type: uint256Type},
		{Type: uint16Type}, {Type: uint32Type}, {Type: uint256Type}, {Type: uint64Type}, {Type: uint64Type}}
	domain := crypto.Keccak256Hash([]byte("AVERLOCK_POLICY_V1"))
	rule, target := common.HexToHash(ruleText), common.HexToHash(targetText)
	threshold, _ := new(big.Int).SetString("1000000000000000000000", 10)
	maximum, _ := new(big.Int).SetString("10000000000000000000000", 10)

	// CREATE_POLICY used time.Now()+7 days. This range brackets the known
	// Phase 6.3E creation period without logging the recovered private expiry.
	for expiry := uint64(1786400000); expiry <= 1786600000; expiry++ {
		encoded, err := args.Pack(domain, rule, threshold, uint16(7000), uint32(1), maximum, uint64(60), expiry)
		if err != nil {
			panic(err)
		}
		if crypto.Keccak256Hash(encoded) != target {
			continue
		}
		value := policy{RuleID: rule, ThresholdUSD18: threshold.String(), ProtectBPS: 7000,
			ScheduleID: 1, MaxPerEventUSD18: maximum.String(), CooldownSeconds: 60, ExpiresAt: expiry}
		output, _ := json.MarshalIndent(value, "", "  ")
		path := filepath.Join("..", "data", "phase63-policy.local.json")
		if err := os.MkdirAll(filepath.Dir(path), 0700); err != nil {
			panic(err)
		}
		if err := os.WriteFile(path, output, 0600); err != nil {
			panic(err)
		}
		fmt.Printf("POLICY_COMMITMENT_VERIFIED ruleId=%s commitment=%s artifact=%s\n", rule.Hex(), target.Hex(), path)
		return
	}
	panic("exact policy commitment was not recovered in the fail-closed search range")
}
