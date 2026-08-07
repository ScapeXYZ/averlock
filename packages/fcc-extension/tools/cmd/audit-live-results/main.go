package main

import (
	"encoding/json"
	"flag"
	"fmt"
	"math/big"
	"strings"

	"extension-scaffold/pkg/decision"
	"extension-scaffold/tools/pkg/fccutils"

	"github.com/ethereum/go-ethereum/accounts/abi"
	"github.com/ethereum/go-ethereum/common"
	"github.com/ethereum/go-ethereum/crypto"
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

type created struct {
	RuleID           common.Hash `json:"ruleId"`
	Accepted         bool        `json:"accepted"`
	PolicyCommitment common.Hash `json:"policyCommitment"`
}

type evaluated = decision.FCCDecision

func main() {
	proxy := flag.String("proxy", "", "extension proxy URL")
	teeText := flag.String("tee", "", "registered TEE address")
	createText := flag.String("create", "", "CREATE_POLICY action ID")
	triggerText := flag.String("trigger", "", "trigger action ID")
	replayText := flag.String("replay", "", "replay action ID")
	cooldownText := flag.String("cooldown", "", "cooldown action ID")
	nonTriggerText := flag.String("non-trigger", "", "non-trigger action ID")
	flag.Parse()
	if *proxy == "" || !common.IsHexAddress(*teeText) {
		panic("valid -proxy and -tee are required")
	}
	tee := common.HexToAddress(*teeText)

	createResponse := verified(*proxy, common.HexToHash(*createText), tee)
	triggerResponse := verified(*proxy, common.HexToHash(*triggerText), tee)
	replayResponse := verified(*proxy, common.HexToHash(*replayText), tee)
	cooldownResponse := verified(*proxy, common.HexToHash(*cooldownText), tee)
	nonTriggerResponse := verified(*proxy, common.HexToHash(*nonTriggerText), tee)

	var c created
	var trigger, cooldown, nonTrigger evaluated
	mustJSON(createResponse.Result.Data, &c)
	trigger = mustDecision(triggerResponse.Result.Data)
	cooldown = mustDecision(cooldownResponse.Result.Data)
	nonTrigger = mustDecision(nonTriggerResponse.Result.Data)

	if !c.Accepted || trigger.RuleID != c.RuleID || cooldown.RuleID != c.RuleID || nonTrigger.RuleID != c.RuleID {
		panic("action results do not share the accepted rule ID")
	}
	// The live runner used a seven-day expiry from the trigger's base timestamp.
	if c.PolicyCommitment != policyCommitment(c.RuleID, trigger.EvaluatedAt+7*24*60*60) {
		panic("policy commitment mismatch")
	}
	if triggerResponse.Result.Status != 1 || !trigger.Triggered || trigger.ProtectedUSD18.String() != "1400000000000000000000" {
		panic("trigger result mismatch")
	}
	if replayResponse.Result.Status != 0 || !strings.Contains(strings.ToLower(replayResponse.Result.Log), "replay") {
		panic("replay was not rejected")
	}
	if cooldownResponse.Result.Status != 1 || cooldown.Triggered || nonTriggerResponse.Result.Status != 1 || nonTrigger.Triggered {
		panic("cooldown/non-trigger result mismatch")
	}
	for _, response := range []*teetypes.ActionResponse{createResponse, triggerResponse, replayResponse, cooldownResponse, nonTriggerResponse} {
		privateResultAudit(response.Result.Data)
	}

	fmt.Printf("RULE_ID=%s\n", c.RuleID.Hex())
	fmt.Printf("POLICY_COMMITMENT=%s MATCH=YES\n", c.PolicyCommitment.Hex())
	fmt.Printf("CREATE_ACTION=%s SIGNATURE=VALID\n", createResponse.Result.ID.Hex())
	fmt.Printf("TRIGGER_ACTION=%s RESULT_HASH=%s SIGNATURE=VALID\n", triggerResponse.Result.ID.Hex(), resultHash(trigger).Hex())
	fmt.Printf("REPLAY_ACTION=%s REJECTED=YES SIGNATURE=VALID\n", replayResponse.Result.ID.Hex())
	fmt.Printf("COOLDOWN_ACTION=%s BLOCKED=YES SIGNATURE=VALID\n", cooldownResponse.Result.ID.Hex())
	fmt.Printf("NON_TRIGGER_ACTION=%s RESULT_HASH=%s SIGNATURE=VALID\n", nonTriggerResponse.Result.ID.Hex(), resultHash(nonTrigger).Hex())
	fmt.Println("PUBLIC_RESULT_PRIVACY=PASS")
}

func verified(proxy string, actionID common.Hash, tee common.Address) *teetypes.ActionResponse {
	response, err := fccutils.ActionResult(proxy, actionID)
	if err != nil {
		panic(err)
	}
	if response.Result.ID != actionID {
		panic("action ID mismatch")
	}
	inner := common.BytesToHash(response.Result.Hash())
	payload, err := csigning.NewPayload(csigning.TEEActionResult, chainID, inner).Hash()
	if err != nil {
		panic(err)
	}
	if err := teeutils.VerifySignature(payload[:], response.Signature, tee); err != nil {
		panic(err)
	}
	return response
}

func mustJSON(data []byte, target any) {
	if err := json.Unmarshal(data, target); err != nil {
		panic(err)
	}
}

func mustDecision(data []byte) decision.FCCDecision {
	d, err := decision.Decode(data)
	if err != nil {
		panic(err)
	}
	return d
}

func number(value string) *big.Int {
	if value == "" {
		value = "0"
	}
	n, ok := new(big.Int).SetString(value, 10)
	if !ok {
		panic("invalid uint256 result")
	}
	return n
}

func policyCommitment(ruleID common.Hash, expiresAt uint64) common.Hash {
	encoded, err := (abi.Arguments{{Type: bytes32Type}, {Type: bytes32Type}, {Type: uint256Type}, {Type: uint16Type},
		{Type: uint32Type}, {Type: uint256Type}, {Type: uint64Type}, {Type: uint64Type}}).Pack(
		policyDomain, ruleID, number("1000000000000000000000"), uint16(7000), uint32(1),
		number("10000000000000000000000"), uint64(60), expiresAt)
	if err != nil {
		panic(err)
	}
	return crypto.Keccak256Hash(encoded)
}

func resultHash(r evaluated) common.Hash {
	hash, err := decision.ResultHash(new(big.Int).SetUint64(chainID), r)
	if err != nil {
		panic(err)
	}
	return hash
}

func privateResultAudit(data []byte) {
	text := string(data)
	for _, forbidden := range []string{"thresholdUsd18", "maxPerEventUsd18", "cooldownSeconds", "expiresAt",
		"1000000000000000000000", "10000000000000000000000"} {
		if strings.Contains(text, forbidden) {
			panic("private policy material present in public result")
		}
	}
}
