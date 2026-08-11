// proxy-keystore is a deliberately small, server-side-only Ethereum V3
// keystore bootstrapper. It never prints its private-key input.
package main

import (
	"crypto/ecdsa"
	"errors"
	"flag"
	"fmt"
	"os"
	"path/filepath"
	"strings"

	"github.com/ethereum/go-ethereum/accounts/keystore"
	"github.com/ethereum/go-ethereum/common"
	"github.com/ethereum/go-ethereum/crypto"
)

func main() {
	if len(os.Args) != 2 && len(os.Args) != 4 && len(os.Args) != 6 {
		fail(errors.New("usage: proxy-keystore address | bootstrap --path PATH | verify --path PATH --expected-address ADDRESS"))
	}
	switch os.Args[1] {
	case "address":
		key, err := bootstrapKey()
		if err != nil {
			fail(err)
		}
		fmt.Println(crypto.PubkeyToAddress(key.PublicKey).Hex())
	case "bootstrap":
		path := parsePath(os.Args[2:])
		key, err := bootstrapKey()
		if err != nil {
			fail(err)
		}
		address, err := createKeystore(path, key, os.Getenv("PROXY_KEYSTORE_PASSWORD"))
		if err != nil {
			fail(err)
		}
		fmt.Println(address.Hex())
	case "verify":
		fs := flag.NewFlagSet("verify", flag.ContinueOnError)
		fs.SetOutput(os.Stderr)
		path := fs.String("path", "", "")
		expected := fs.String("expected-address", "", "")
		if err := fs.Parse(os.Args[2:]); err != nil {
			fail(errors.New("invalid verify arguments"))
		}
		address, err := verifyKeystore(*path, *expected, os.Getenv("PROXY_KEYSTORE_PASSWORD"))
		if err != nil {
			fail(err)
		}
		fmt.Println(address.Hex())
	default:
		fail(errors.New("unknown command"))
	}
}

func parsePath(args []string) string {
	fs := flag.NewFlagSet("bootstrap", flag.ContinueOnError)
	fs.SetOutput(os.Stderr)
	path := fs.String("path", "", "")
	if err := fs.Parse(args); err != nil || *path == "" {
		fail(errors.New("--path is required"))
	}
	return *path
}

func bootstrapKey() (*ecdsa.PrivateKey, error) {
	raw := strings.TrimSpace(os.Getenv("PROXY_KEYSTORE_BOOTSTRAP_PRIVATE_KEY"))
	if raw == "" {
		return nil, errors.New("PROXY_KEYSTORE_BOOTSTRAP_PRIVATE_KEY is required")
	}
	raw = strings.TrimPrefix(strings.TrimPrefix(raw, "0x"), "0X")
	key, err := crypto.HexToECDSA(raw)
	if err != nil {
		return nil, errors.New("PROXY_KEYSTORE_BOOTSTRAP_PRIVATE_KEY is invalid")
	}
	return key, nil
}

func createKeystore(path string, key *ecdsa.PrivateKey, password string) (common.Address, error) {
	if password == "" {
		return common.Address{}, errors.New("PROXY_KEYSTORE_PASSWORD is required")
	}
	if path == "" {
		return common.Address{}, errors.New("--path is required")
	}
	address := crypto.PubkeyToAddress(key.PublicKey)
	json, err := keystore.EncryptKey(&keystore.Key{Address: address, PrivateKey: key}, password, keystore.StandardScryptN, keystore.StandardScryptP)
	if err != nil {
		return common.Address{}, errors.New("encrypting proxy keystore failed")
	}
	dir := filepath.Dir(path)
	tmp, err := os.CreateTemp(dir, ".proxy-keystore-*")
	if err != nil {
		return common.Address{}, errors.New("creating temporary keystore failed")
	}
	tmpPath := tmp.Name()
	defer os.Remove(tmpPath)
	if err := tmp.Chmod(0600); err != nil {
		tmp.Close()
		return common.Address{}, errors.New("securing temporary keystore failed")
	}
	if _, err := tmp.Write(json); err != nil {
		tmp.Close()
		return common.Address{}, errors.New("writing encrypted proxy keystore failed")
	}
	if err := tmp.Sync(); err != nil {
		tmp.Close()
		return common.Address{}, errors.New("syncing encrypted proxy keystore failed")
	}
	if err := tmp.Close(); err != nil {
		return common.Address{}, errors.New("closing encrypted proxy keystore failed")
	}
	// link is atomic and fails if another process created the target first.
	if err := os.Link(tmpPath, path); err != nil {
		return common.Address{}, errors.New("encrypted proxy keystore already exists or could not be installed")
	}
	if err := os.Chmod(path, 0600); err != nil {
		return common.Address{}, errors.New("securing encrypted proxy keystore failed")
	}
	return address, nil
}

func verifyKeystore(path, expected, password string) (common.Address, error) {
	if path == "" || password == "" {
		return common.Address{}, errors.New("keystore path and password are required")
	}
	if !common.IsHexAddress(expected) || common.HexToAddress(expected) == (common.Address{}) {
		return common.Address{}, errors.New("expected signer address is invalid")
	}
	json, err := os.ReadFile(path)
	if err != nil {
		return common.Address{}, errors.New("reading encrypted proxy keystore failed")
	}
	key, err := keystore.DecryptKey(json, password)
	if err != nil {
		return common.Address{}, errors.New("decrypting encrypted proxy keystore failed")
	}
	address := crypto.PubkeyToAddress(key.PrivateKey.PublicKey)
	key.PrivateKey.D.SetInt64(0)
	if address != common.HexToAddress(expected) {
		return common.Address{}, errors.New("derived signer address does not match expected signer address")
	}
	return address, nil
}

func fail(err error) { fmt.Fprintln(os.Stderr, "proxy keystore:", err); os.Exit(1) }
