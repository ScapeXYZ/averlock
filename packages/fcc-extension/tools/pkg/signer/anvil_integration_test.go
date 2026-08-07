//go:build integration

package signer

import (
	"context"
	"math/big"
	"os"
	"testing"
	"time"

	"github.com/ethereum/go-ethereum/accounts/abi/bind"
	"github.com/ethereum/go-ethereum/common"
	"github.com/ethereum/go-ethereum/core/types"
	"github.com/ethereum/go-ethereum/ethclient"
)

func TestEncryptedKeystoreSignsLocalAnvilTransaction(t *testing.T) {
	rpcURL := os.Getenv("ANVIL_RPC_URL")
	if rpcURL == "" {
		t.Skip("ANVIL_RPC_URL not set")
	}
	client, err := ethclient.Dial(rpcURL)
	if err != nil {
		t.Fatal(err)
	}
	defer client.Close()
	ctx, cancel := context.WithTimeout(context.Background(), 20*time.Second)
	defer cancel()
	chainID, err := client.ChainID(ctx)
	if err != nil {
		t.Fatal(err)
	}
	path, expected := testKeystore(t)
	key, address, err := Load(config(path, expected, chainID.Int64()), chainID, password(testPassword))
	if err != nil {
		t.Fatal(err)
	}
	defer zeroPrivateKey(key)
	var ignored any
	if err := client.Client().CallContext(ctx, &ignored, "anvil_setBalance", address.Hex(), "0x56BC75E2D63100000"); err != nil {
		t.Fatal(err)
	}
	nonce, err := client.PendingNonceAt(ctx, address)
	if err != nil {
		t.Fatal(err)
	}
	gasPrice, err := client.SuggestGasPrice(ctx)
	if err != nil {
		t.Fatal(err)
	}
	unsigned := types.NewTransaction(nonce, common.HexToAddress("0x000000000000000000000000000000000000dEaD"), big.NewInt(1), 21000, gasPrice, nil)
	opts, err := bind.NewKeyedTransactorWithChainID(key, chainID)
	if err != nil {
		t.Fatal(err)
	}
	signed, err := opts.Signer(address, unsigned)
	if err != nil {
		t.Fatal(err)
	}
	if err := client.SendTransaction(ctx, signed); err != nil {
		t.Fatal(err)
	}
	receipt, err := bind.WaitMined(ctx, client, signed)
	if err != nil {
		t.Fatal(err)
	}
	if receipt.Status != types.ReceiptStatusSuccessful {
		t.Fatalf("receipt status %d", receipt.Status)
	}
}
