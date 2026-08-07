package config

import (
	"os"
	"testing"

	"github.com/ethereum/go-ethereum/accounts/keystore"
	"github.com/ethereum/go-ethereum/crypto"
)

func TestProxyKeystoreWrongChainFailsBeforeReadingKeystore(t *testing.T) {
	t.Setenv("PROXY_EXPECTED_CHAIN_ID", "114")
	t.Setenv("PROXY_EXPECTED_SIGNER_ADDRESS", "0x0000000000000000000000000000000000000001")
	t.Setenv("PROXY_KEYSTORE_PATH", "/does/not/exist")
	_, err := privateKeyFromKeystore(31337)
	if err == nil {
		t.Fatal("expected chain mismatch")
	}
}

func TestProxyKeystoreMissingFileRejected(t *testing.T) {
	t.Setenv("PROXY_EXPECTED_CHAIN_ID", "114")
	t.Setenv("PROXY_EXPECTED_SIGNER_ADDRESS", "0x0000000000000000000000000000000000000001")
	t.Setenv("PROXY_KEYSTORE_PATH", "/does/not/exist")
	_, err := privateKeyFromKeystore(114)
	if err == nil {
		t.Fatal("expected missing keystore error")
	}
}

func TestClearPassword(t *testing.T) {
	secret := []byte("test-only")
	clearPassword(secret)
	for _, b := range secret {
		if b != 0 { t.Fatal("password buffer not cleared") }
	}
}

func TestKeystoreModeRejectsRawKeyFallback(t *testing.T) {
	t.Setenv("PROXY_PRIVATE_KEY", "test-only-raw-key-must-not-be-read")
	t.Setenv("PROXY_EXPECTED_CHAIN_ID", "114")
	_, err := privateKeyFromKeystore(114)
	if err == nil || err.Error() != "raw PROXY_PRIVATE_KEY/PRIVATE_KEY must be unset in keystore mode" {
		t.Fatalf("expected fail-closed raw-key rejection, got %v", err)
	}
}

func TestProxyEncryptedKeystoreLoad(t *testing.T) {
	privateKey, err := crypto.GenerateKey()
	if err != nil { t.Fatal(err) }
	address := crypto.PubkeyToAddress(privateKey.PublicKey)
	encrypted, err := keystore.EncryptKey(&keystore.Key{Address: address, PrivateKey: privateKey}, "test-only-password", keystore.LightScryptN, keystore.LightScryptP)
	if err != nil { t.Fatal(err) }
	path := t.TempDir() + "/account"
	if err := os.WriteFile(path, encrypted, 0600); err != nil { t.Fatal(err) }
	t.Setenv("PROXY_EXPECTED_CHAIN_ID", "114")
	t.Setenv("PROXY_EXPECTED_SIGNER_ADDRESS", address.Hex())
	t.Setenv("PROXY_KEYSTORE_PATH", path)
	previous := readInteractivePassword
	readInteractivePassword = func() ([]byte, error) { return []byte("test-only-password"), nil }
	t.Cleanup(func() { readInteractivePassword = previous })
	loaded, err := privateKeyFromKeystore(114)
	if err != nil { t.Fatal(err) }
	if crypto.PubkeyToAddress(loaded.PublicKey) != address { t.Fatal("derived address mismatch") }
}

func TestProxyEncryptedKeystoreLoadsServerSecretWithoutTTY(t *testing.T) {
	privateKey, err := crypto.GenerateKey()
	if err != nil { t.Fatal(err) }
	address := crypto.PubkeyToAddress(privateKey.PublicKey)
	encrypted, err := keystore.EncryptKey(&keystore.Key{Address: address, PrivateKey: privateKey}, "railway-secret", keystore.LightScryptN, keystore.LightScryptP)
	if err != nil { t.Fatal(err) }
	path := t.TempDir() + "/account"
	if err := os.WriteFile(path, encrypted, 0600); err != nil { t.Fatal(err) }
	t.Setenv("PROXY_EXPECTED_CHAIN_ID", "114")
	t.Setenv("PROXY_EXPECTED_SIGNER_ADDRESS", address.Hex())
	t.Setenv("PROXY_KEYSTORE_PATH", path)
	t.Setenv("PROXY_KEYSTORE_PASSWORD", "railway-secret")
	previous := readInteractivePassword
	readInteractivePassword = func() ([]byte, error) { t.Fatal("TTY password must not be requested"); return nil, nil }
	t.Cleanup(func() { readInteractivePassword = previous })
	loaded, err := privateKeyFromKeystore(114)
	if err != nil { t.Fatal(err) }
	if crypto.PubkeyToAddress(loaded.PublicKey) != address { t.Fatal("derived address mismatch") }
}

func TestProxyEncryptedKeystoreWrongPasswordRejected(t *testing.T) {
	privateKey, _ := crypto.GenerateKey()
	address := crypto.PubkeyToAddress(privateKey.PublicKey)
	encrypted, _ := keystore.EncryptKey(&keystore.Key{Address: address, PrivateKey: privateKey}, "correct-test-password", keystore.LightScryptN, keystore.LightScryptP)
	path := t.TempDir() + "/account"
	if err := os.WriteFile(path, encrypted, 0600); err != nil { t.Fatal(err) }
	t.Setenv("PROXY_EXPECTED_CHAIN_ID", "114")
	t.Setenv("PROXY_EXPECTED_SIGNER_ADDRESS", address.Hex())
	t.Setenv("PROXY_KEYSTORE_PATH", path)
	t.Setenv("PROXY_KEYSTORE_PASSWORD", "wrong-test-password")
	if _, err := privateKeyFromKeystore(114); err == nil { t.Fatal("incorrect password accepted") }
}

func TestProxyEncryptedKeystoreWrongExpectedSignerRejected(t *testing.T) {
	privateKey, _ := crypto.GenerateKey()
	address := crypto.PubkeyToAddress(privateKey.PublicKey)
	encrypted, _ := keystore.EncryptKey(&keystore.Key{Address: address, PrivateKey: privateKey}, "secret", keystore.LightScryptN, keystore.LightScryptP)
	path := t.TempDir() + "/account"
	if err := os.WriteFile(path, encrypted, 0600); err != nil { t.Fatal(err) }
	t.Setenv("PROXY_EXPECTED_CHAIN_ID", "114")
	t.Setenv("PROXY_EXPECTED_SIGNER_ADDRESS", "0x0000000000000000000000000000000000000001")
	t.Setenv("PROXY_KEYSTORE_PATH", path)
	t.Setenv("PROXY_KEYSTORE_PASSWORD", "secret")
	if _, err := privateKeyFromKeystore(114); err == nil { t.Fatal("wrong expected signer accepted") }
}
