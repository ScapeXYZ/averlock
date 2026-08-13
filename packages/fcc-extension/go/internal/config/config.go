// Package config contains configuration values and defaults used by the extension.
package config

import (
	"os"
	"strconv"
	"time"

	"github.com/ethereum/go-ethereum/common"
)

const (
	Version = "0.1.0"

	OPTypeAverlockGuard     = "AVERLOCK_GUARD"
	OPCommandCreatePolicy   = "CREATE_POLICY"
	OPCommandEvaluateGuard  = "EVALUATE_GUARD"
	ScheduleThirtyDayLinear = uint32(1)
	Coston2ChainID          = uint64(114)
	ResultValiditySeconds   = uint64(600)
	DefaultCoston2RPCURL    = "https://coston2-api.flare.network/ext/C/rpc"
	// A live FCC instance must be explicitly bound to the replacement manager.
	// Never silently fall back to the retired manager after a replacement deploy.
	ExpectedGuardManager    = "0x0000000000000000000000000000000000000000"
	TimeoutShutdown         = 5 * time.Second
)

var (
	ExtensionPort       = 8080
	SignPort            = 9090
	Coston2RPCURL       = DefaultCoston2RPCURL
	GuardManagerAddress = common.HexToAddress(ExpectedGuardManager)
)

func init() {
	if value := os.Getenv("EXTENSION_PORT"); value != "" {
		if parsed, err := strconv.Atoi(value); err == nil {
			ExtensionPort = parsed
		}
	}
	if value := os.Getenv("SIGN_PORT"); value != "" {
		if parsed, err := strconv.Atoi(value); err == nil {
			SignPort = parsed
		}
	}
	// Railway's tee-node and the extension must use the same canonical chain
	// variable. Retain COSTON2_RPC_URL only as a backward-compatible fallback.
	if value := os.Getenv("CHAIN_URL"); value != "" {
		Coston2RPCURL = value
	} else if value := os.Getenv("COSTON2_RPC_URL"); value != "" {
		Coston2RPCURL = value
	}
	if value := os.Getenv("AVERLOCK_GUARD_MANAGER"); value != "" {
		if common.IsHexAddress(value) {
			GuardManagerAddress = common.HexToAddress(value)
		} else {
			GuardManagerAddress = common.Address{}
		}
	}
}
