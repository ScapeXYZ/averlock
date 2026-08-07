package signer

import (
	"bytes"
	"math/big"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/ethereum/go-ethereum/accounts/keystore"
	"github.com/ethereum/go-ethereum/common"
	"github.com/ethereum/go-ethereum/crypto"
)

const testPassword = "test-only-password"

func testKeystore(t *testing.T) (string, common.Address) {
	t.Helper()
	key, err := crypto.GenerateKey()
	if err != nil {
		t.Fatal(err)
	}
	address := crypto.PubkeyToAddress(key.PublicKey)
	json, err := keystore.EncryptKey(&keystore.Key{Address: address, PrivateKey: key}, testPassword, keystore.LightScryptN, keystore.LightScryptP)
	if err != nil {
		t.Fatal(err)
	}
	path := filepath.Join(t.TempDir(), "account")
	if err := os.WriteFile(path, json, 0600); err != nil {
		t.Fatal(err)
	}
	zeroPrivateKey(key)
	return path, address
}

func config(path string, address common.Address, chain int64) Config {
	return Config{Mode: ModeKeystore, KeystorePath: path, ExpectedAddress: address, ExpectedChainID: big.NewInt(chain)}
}

func password(value string) PasswordReader {
	return func() ([]byte, error) { return []byte(value), nil }
}

func TestKeystoreModeConfigurationRecognized(t *testing.T) {
	t.Setenv("SIGNER_MODE", "keystore")
	t.Setenv("DEPLOYMENT_KEYSTORE_ACCOUNT", "test-account")
	t.Setenv("EXPECTED_SIGNER_ADDRESS", "0x0000000000000000000000000000000000000001")
	t.Setenv("EXPECTED_CHAIN_ID", "114")
	cfg, err := ConfigFromEnv()
	if err != nil {
		t.Fatal(err)
	}
	if cfg.Mode != ModeKeystore || cfg.KeystoreAccount != "test-account" || cfg.ExpectedChainID.Cmp(big.NewInt(114)) != 0 {
		t.Fatalf("unexpected config: %+v", cfg)
	}
}

func TestKeystoreModeRecognizedAndLoads(t *testing.T) {
	path, expected := testKeystore(t)
	key, address, err := Load(config(path, expected, 31337), big.NewInt(31337), password(testPassword))
	if err != nil {
		t.Fatal(err)
	}
	defer zeroPrivateKey(key)
	if address != expected {
		t.Fatalf("got %s want %s", address, expected)
	}
}

func TestMissingKeystoreRejected(t *testing.T) {
	_, _, err := Load(config(filepath.Join(t.TempDir(), "missing"), common.HexToAddress("0x1"), 31337), big.NewInt(31337), password(testPassword))
	if err == nil {
		t.Fatal("expected error")
	}
}

func TestIncorrectPasswordRejectedWithoutLeakingIt(t *testing.T) {
	path, expected := testKeystore(t)
	_, _, err := Load(config(path, expected, 31337), big.NewInt(31337), password("never-log-this"))
	if err == nil || strings.Contains(err.Error(), "never-log-this") {
		t.Fatalf("unsafe error: %v", err)
	}
}

func TestWrongExpectedAddressRejected(t *testing.T) {
	path, _ := testKeystore(t)
	_, _, err := Load(config(path, common.HexToAddress("0x0000000000000000000000000000000000000001"), 31337), big.NewInt(31337), password(testPassword))
	if err == nil {
		t.Fatal("expected mismatch")
	}
}

func TestWrongChainRejectedBeforePasswordPrompt(t *testing.T) {
	path, expected := testKeystore(t)
	called := false
	_, _, err := Load(config(path, expected, 114), big.NewInt(31337), func() ([]byte, error) { called = true; return nil, nil })
	if err == nil || called {
		t.Fatal("expected fail-closed chain check before password")
	}
}

func TestRawKeyCompatibility(t *testing.T) {
	key, _ := crypto.GenerateKey()
	raw := common.Bytes2Hex(crypto.FromECDSA(key))
	expected := crypto.PubkeyToAddress(key.PublicKey)
	zeroPrivateKey(key)
	loaded, address, err := Load(Config{Mode: ModeRaw, RawPrivateKey: raw, ExpectedAddress: expected, ExpectedChainID: big.NewInt(31337)}, big.NewInt(31337), nil)
	if err != nil {
		t.Fatal(err)
	}
	defer zeroPrivateKey(loaded)
	if address != expected {
		t.Fatal("wrong address")
	}
}

func TestErrorsAndPromptDoNotContainSecrets(t *testing.T) {
	path, expected := testKeystore(t)
	secret := "log-sentinel-password"
	_, _, err := Load(config(path, expected, 31337), big.NewInt(31337), password(secret))
	if err == nil || strings.Contains(err.Error(), secret) {
		t.Fatalf("password leaked: %v", err)
	}
	var output bytes.Buffer
	reader := TerminalPasswordReader(os.Stdin, &output)
	_, _ = reader()
	if strings.Contains(output.String(), secret) {
		t.Fatal("password leaked in prompt")
	}
}
