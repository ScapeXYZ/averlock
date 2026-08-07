package decision

import (
	"math/big"
	"strings"
	"testing"

	"github.com/ethereum/go-ethereum/common"
)

const (
	triggeredHex  = "29ee4f1dc357d1ebeceed3136bae12e24a3611344ef4f0ccac235bd9ef2783b000000000000000000000000000000000000000000000000000000000000011110000000000000000000000000000000000000000000000000000000000002222000000000000000000000000000000000000000000000000000000000000000100000000000000000000000000000000000000000000004be4e7267b6ae000000000000000000000000000000000000000000000000000000000000000001b58000000000000000000000000000000000000000000000000000000000000000100000000000000000000000000000000000000000000006c6b935b8bbd400000000000000000000000000000000000000000000000000000000000006b49d200000000000000000000000000000000000000000000000000000000000000002a000000000000000000000000000000000000000000000000000000006b49d458"
	nonTriggerHex = "29ee4f1dc357d1ebeceed3136bae12e24a3611344ef4f0ccac235bd9ef2783b000000000000000000000000000000000000000000000000000000000000011110000000000000000000000000000000000000000000000000000000000002222000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000006c6b935b8bbd400000000000000000000000000000000000000000000000000000000000006b49d200000000000000000000000000000000000000000000000000000000000000002a000000000000000000000000000000000000000000000000000000006b49d458"
)

func fixture(triggered bool) FCCDecision {
	protected := new(big.Int)
	protectBPS := uint16(0)
	scheduleID := uint32(0)
	if triggered {
		protected.SetString("1400000000000000000000", 10)
		protectBPS = 7000
		scheduleID = 1
	}
	value, _ := new(big.Int).SetString("2000000000000000000000", 10)
	return FCCDecision{Domain: Domain, RuleID: common.HexToHash("0x1111"), EventHash: common.HexToHash("0x2222"),
		Triggered: triggered, ProtectedUSD18: protected, ProtectBPS: protectBPS, ScheduleID: scheduleID,
		EventValueUSD18: value, EvaluatedAt: 1_800_000_000, Nonce: big.NewInt(42), ResultExpiry: 1_800_000_600}
}

func TestGoldenTriggered(t *testing.T) {
	d := fixture(true)
	encoded, err := Encode(d)
	if err != nil {
		t.Fatal(err)
	}
	hash, err := ResultHash(big.NewInt(114), d)
	if err != nil {
		t.Fatal(err)
	}
	expectedHex := strings.TrimPrefix(Domain.Hex(), "0x") + triggeredHex[64:]
	if common.Bytes2Hex(encoded) != expectedHex {
		t.Fatalf("triggered golden ABI changed: %s hash=%s", common.Bytes2Hex(encoded), hash.Hex())
	}
	if hash != common.HexToHash("0xba84779793bf303b62eef13d5a656a1dba8e0ebef58becf3bd719544eee53e43") {
		t.Fatal("triggered golden hash changed")
	}
	decoded, err := Decode(encoded)
	if err != nil {
		t.Fatal(err)
	}
	if decoded.ProtectBPS != 7000 || decoded.ScheduleID != 1 || decoded.Nonce.Cmp(big.NewInt(42)) != 0 {
		t.Fatal("round trip mismatch")
	}
}

func TestGoldenNonTrigger(t *testing.T) {
	d := fixture(false)
	encoded, err := Encode(d)
	if err != nil {
		t.Fatal(err)
	}
	hash, err := ResultHash(big.NewInt(114), d)
	if err != nil {
		t.Fatal(err)
	}
	expectedHex := strings.TrimPrefix(Domain.Hex(), "0x") + nonTriggerHex[64:]
	if common.Bytes2Hex(encoded) != expectedHex {
		t.Fatalf("non-trigger golden ABI changed: %s hash=%s", common.Bytes2Hex(encoded), hash.Hex())
	}
	if hash != common.HexToHash("0x85aa5a3a9c8130fc29447f745b49447108a8c18953920f131cd29adc14bc2df1") {
		t.Fatal("non-trigger golden hash changed")
	}
	if _, err := Decode(encoded); err != nil {
		t.Fatal(err)
	}
}

func TestProtectBPSUint16Boundary(t *testing.T) {
	d := fixture(true)
	d.ProtectBPS = ^uint16(0)
	encoded, err := Encode(d)
	if err != nil {
		t.Fatal(err)
	}
	decoded, err := Decode(encoded)
	if err != nil {
		t.Fatal(err)
	}
	if decoded.ProtectBPS != ^uint16(0) {
		t.Fatal("uint16 boundary changed")
	}
}

func TestMalformedLengthsRejected(t *testing.T) {
	encoded, _ := Encode(fixture(true))
	if _, err := Decode(encoded[:len(encoded)-1]); err == nil {
		t.Fatal("truncated payload accepted")
	}
	if _, err := Decode(append(encoded, 0)); err == nil {
		t.Fatal("extra byte accepted")
	}
	if _, err := Decode([]byte{1, 2, 3}); err == nil {
		t.Fatal("malformed payload accepted")
	}
}

func TestWrongDomainRejected(t *testing.T) {
	d := fixture(true)
	d.Domain = common.HexToHash("0xdead")
	if _, err := Encode(d); err == nil {
		t.Fatal("wrong domain accepted")
	}
}
