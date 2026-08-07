package extension

import (
	"context"
	"fmt"
	"math/big"
	"time"

	"extension-scaffold/internal/config"

	"github.com/ethereum/go-ethereum/accounts/abi"
	"github.com/ethereum/go-ethereum/common"
	"github.com/ethereum/go-ethereum/common/hexutil"
	"github.com/ethereum/go-ethereum/crypto"
	"github.com/ethereum/go-ethereum/ethclient"
	"github.com/ethereum/go-ethereum/rpc"
)

type eventSnapshot struct {
	RuleID           common.Hash
	EventValueUSD18  *big.Int
	PriceUSD18       *big.Int
	PriceTimestamp   uint64
	PaymentTimestamp uint64
	PreparedAt       uint64
	Consumed         bool
}

type eventSnapshotReader interface {
	GetSnapshot(context.Context, common.Hash) (eventSnapshot, error)
	Ready(context.Context) error
}

type staticSnapshotReader struct {
	snapshot eventSnapshot
	err      error
}

func (r *staticSnapshotReader) GetSnapshot(context.Context, common.Hash) (eventSnapshot, error) {
	return r.snapshot, r.err
}

func (r *staticSnapshotReader) Ready(context.Context) error { return r.err }

type guardManagerReader struct {
	rpcURL  string
	manager common.Address
	rpc     *rpc.Client
	initErr error
}

func newGuardManagerReader() eventSnapshotReader {
	r := &guardManagerReader{rpcURL: config.Coston2RPCURL, manager: config.GuardManagerAddress}
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	r.initErr = r.connectAndValidate(ctx)
	return r
}

func (r *guardManagerReader) connectAndValidate(ctx context.Context) error {
	expected := common.HexToAddress(config.ExpectedGuardManager)
	if r.rpcURL == "" || r.manager != expected || config.GuardManagerAddress != expected {
		return fmt.Errorf("GuardManager snapshot reader is not safely configured")
	}
	rpcClient, err := rpc.DialContext(ctx, r.rpcURL)
	if err != nil {
		return fmt.Errorf("connecting to Coston2: %w", err)
	}
	client := ethclient.NewClient(rpcClient)
	chainID, err := client.ChainID(ctx)
	if err != nil || chainID.Uint64() != config.Coston2ChainID {
		rpcClient.Close()
		return fmt.Errorf("wrong Coston2 chain ID: %v (%v)", chainID, err)
	}
	code, err := client.CodeAt(ctx, r.manager, nil)
	if err != nil {
		rpcClient.Close()
		return fmt.Errorf("reading GuardManager bytecode: %w", err)
	}
	if len(code) == 0 {
		rpcClient.Close()
		return fmt.Errorf("GuardManager has no bytecode")
	}
	r.rpc = rpcClient
	return nil
}

func (r *guardManagerReader) Ready(ctx context.Context) error {
	if r.initErr != nil {
		return r.initErr
	}
	// A lightweight live RPC call proves that the already-validated connection
	// is still usable without repeating chain/code checks on every action.
	var chainID hexutil.Big
	if err := r.rpc.CallContext(ctx, &chainID, "eth_chainId"); err != nil {
		return fmt.Errorf("Coston2 readiness call: %w", err)
	}
	if (*big.Int)(&chainID).Uint64() != config.Coston2ChainID {
		return fmt.Errorf("wrong Coston2 chain ID during readiness: %s", (*big.Int)(&chainID))
	}
	return nil
}

func (r *guardManagerReader) GetSnapshot(ctx context.Context, eventHash common.Hash) (eventSnapshot, error) {
	if r.initErr != nil {
		return eventSnapshot{}, r.initErr
	}
	if r.rpc == nil {
		return eventSnapshot{}, fmt.Errorf("GuardManager RPC client is not initialized")
	}
	args, _ := (abi.Arguments{{Type: mustABIType("bytes32")}}).Pack(eventHash)
	callData := func(signature string) hexutil.Bytes {
		selector := crypto.Keccak256([]byte(signature))[:4]
		return append(append([]byte{}, selector...), args...)
	}
	var snapshotOut, consumedOut hexutil.Bytes
	batch := []rpc.BatchElem{
		{Method: "eth_call", Args: []any{map[string]any{"to": r.manager, "data": callData("getEvaluationSnapshot(bytes32)")}, "latest"}, Result: &snapshotOut},
		{Method: "eth_call", Args: []any{map[string]any{"to": r.manager, "data": callData("isEventConsumed(bytes32)")}, "latest"}, Result: &consumedOut},
	}
	if err := r.rpc.BatchCallContext(ctx, batch); err != nil {
		return eventSnapshot{}, fmt.Errorf("batch reading GuardManager snapshot: %w", err)
	}
	for _, item := range batch {
		if item.Error != nil {
			return eventSnapshot{}, fmt.Errorf("GuardManager batch call failed: %w", item.Error)
		}
	}
	if len(snapshotOut) != 192 || len(consumedOut) != 32 {
		return eventSnapshot{}, fmt.Errorf("invalid GuardManager response lengths: snapshot=%d consumed=%d", len(snapshotOut), len(consumedOut))
	}
	return eventSnapshot{
		RuleID: common.BytesToHash(snapshotOut[0:32]), EventValueUSD18: new(big.Int).SetBytes(snapshotOut[32:64]),
		PriceUSD18: new(big.Int).SetBytes(snapshotOut[64:96]), PriceTimestamp: new(big.Int).SetBytes(snapshotOut[96:128]).Uint64(),
		PaymentTimestamp: new(big.Int).SetBytes(snapshotOut[128:160]).Uint64(), PreparedAt: new(big.Int).SetBytes(snapshotOut[160:192]).Uint64(),
		Consumed: new(big.Int).SetBytes(consumedOut).Sign() != 0,
	}, nil
}

func mustABIType(name string) abi.Type {
	value, err := abi.NewType(name, "", nil)
	if err != nil {
		panic(err)
	}
	return value
}
