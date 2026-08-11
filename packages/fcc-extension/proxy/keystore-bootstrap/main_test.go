package main

import (
	"bytes"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/ethereum/go-ethereum/crypto"
)

func TestMissingBootstrapSecretAndMissingFile(t *testing.T) {
	t.Setenv("PROXY_KEYSTORE_BOOTSTRAP_PRIVATE_KEY", "")
	if _, err := bootstrapKey(); err == nil {
		t.Fatal("missing bootstrap secret accepted")
	}
}

func TestExistingKeystoreIsNotRecreated(t *testing.T) {
	key, err := crypto.GenerateKey()
	if err != nil {
		t.Fatal(err)
	}
	path := filepath.Join(t.TempDir(), "proxy-keystore.json")
	if _, err := createKeystore(path, key, "password"); err != nil {
		t.Fatal(err)
	}
	original, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := createKeystore(path, key, "password"); err == nil {
		t.Fatal("existing keystore was recreated")
	}
	after, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	if !bytes.Equal(original, after) {
		t.Fatal("existing keystore changed")
	}
	info, err := os.Stat(path)
	if err != nil {
		t.Fatal(err)
	}
	if info.Mode().Perm() != 0600 {
		t.Fatalf("keystore mode = %o, want 0600", info.Mode().Perm())
	}
}

func TestCreateKeystoreFilesystemErrorIncludesSafePathAndOSCause(t *testing.T) {
	key, err := crypto.GenerateKey()
	if err != nil {
		t.Fatal(err)
	}
	blocker := filepath.Join(t.TempDir(), "not-a-directory")
	if err := os.WriteFile(blocker, []byte("x"), 0600); err != nil {
		t.Fatal(err)
	}
	path := filepath.Join(blocker, "proxy-keystore.json")
	_, err = createKeystore(path, key, "password")
	if err == nil {
		t.Fatal("expected filesystem error")
	}
	if !strings.Contains(err.Error(), blocker) || !strings.Contains(err.Error(), "not a directory") {
		t.Fatalf("filesystem error should contain safe path and OS cause, got %v", err)
	}
}

func TestWrongExpectedSignerAddressRejected(t *testing.T) {
	key, err := crypto.GenerateKey()
	if err != nil {
		t.Fatal(err)
	}
	path := filepath.Join(t.TempDir(), "proxy-keystore.json")
	if _, err := createKeystore(path, key, "password"); err != nil {
		t.Fatal(err)
	}
	if _, err := verifyKeystore(path, "0x0000000000000000000000000000000000000001", "password"); err == nil {
		t.Fatal("wrong expected signer accepted")
	}
}

func TestErrorsNeverIncludePrivateKey(t *testing.T) {
	private := "test-private-key-must-not-appear"
	t.Setenv("PROXY_KEYSTORE_BOOTSTRAP_PRIVATE_KEY", private)
	_, err := bootstrapKey()
	if err == nil || bytes.Contains([]byte(err.Error()), []byte(private)) {
		t.Fatal("private key leaked in error")
	}
}
