// Package signer loads transaction keys using either the upstream raw-key
// environment mode or AVERLOCK's encrypted Ethereum V3 keystore mode.
package signer

import (
	"crypto/ecdsa"
	"errors"
	"fmt"
	"io"
	"math/big"
	"os"
	"path/filepath"
	"strings"

	"github.com/ethereum/go-ethereum/accounts/keystore"
	"github.com/ethereum/go-ethereum/common"
	"github.com/ethereum/go-ethereum/crypto"
	"golang.org/x/term"
)

const (
	ModeKeystore = "keystore"
	ModeRaw      = "raw"
)

type Config struct {
	Mode            string
	KeystoreAccount string
	KeystorePath    string
	RawPrivateKey   string
	ExpectedAddress common.Address
	ExpectedChainID *big.Int
}

type PasswordReader func() ([]byte, error)

func ConfigFromEnv() (Config, error) {
	mode := strings.ToLower(strings.TrimSpace(os.Getenv("SIGNER_MODE")))
	if mode == "" {
		mode = ModeKeystore
	}
	expectedAddressRaw := strings.TrimSpace(os.Getenv("EXPECTED_SIGNER_ADDRESS"))
	if !common.IsHexAddress(expectedAddressRaw) {
		return Config{}, errors.New("EXPECTED_SIGNER_ADDRESS must be a valid nonzero address")
	}
	expectedAddress := common.HexToAddress(expectedAddressRaw)
	if expectedAddress == (common.Address{}) {
		return Config{}, errors.New("EXPECTED_SIGNER_ADDRESS must be nonzero")
	}
	expectedChainRaw := strings.TrimSpace(os.Getenv("EXPECTED_CHAIN_ID"))
	if expectedChainRaw == "" {
		expectedChainRaw = "114"
	}
	expectedChain, ok := new(big.Int).SetString(expectedChainRaw, 10)
	if !ok || expectedChain.Sign() <= 0 {
		return Config{}, errors.New("EXPECTED_CHAIN_ID must be a positive decimal integer")
	}
	return Config{
		Mode:            mode,
		KeystoreAccount: strings.TrimSpace(os.Getenv("DEPLOYMENT_KEYSTORE_ACCOUNT")),
		KeystorePath:    strings.TrimSpace(os.Getenv("DEPLOYMENT_KEYSTORE_PATH")),
		RawPrivateKey:   strings.TrimSpace(os.Getenv("DEPLOYMENT_PRIVATE_KEY")),
		ExpectedAddress: expectedAddress,
		ExpectedChainID: expectedChain,
	}, nil
}

func LoadFromEnvironment(actualChainID *big.Int) (*ecdsa.PrivateKey, common.Address, error) {
	cfg, err := ConfigFromEnv()
	if err != nil {
		return nil, common.Address{}, err
	}
	return Load(cfg, actualChainID, TerminalPasswordReader(os.Stdin, os.Stderr))
}

func Load(cfg Config, actualChainID *big.Int, readPassword PasswordReader) (*ecdsa.PrivateKey, common.Address, error) {
	if cfg.ExpectedChainID == nil || actualChainID == nil || cfg.ExpectedChainID.Cmp(actualChainID) != 0 {
		return nil, common.Address{}, fmt.Errorf("refusing signer: chain ID mismatch (expected %v, got %v)", cfg.ExpectedChainID, actualChainID)
	}
	var (
		key *ecdsa.PrivateKey
		err error
	)
	switch strings.ToLower(strings.TrimSpace(cfg.Mode)) {
	case ModeKeystore:
		key, err = loadKeystore(cfg, readPassword)
	case ModeRaw:
		key, err = loadRaw(cfg.RawPrivateKey)
	default:
		return nil, common.Address{}, fmt.Errorf("unsupported SIGNER_MODE %q", cfg.Mode)
	}
	if err != nil {
		return nil, common.Address{}, err
	}
	address := crypto.PubkeyToAddress(key.PublicKey)
	if cfg.ExpectedAddress == (common.Address{}) || address != cfg.ExpectedAddress {
		zeroPrivateKey(key)
		return nil, common.Address{}, fmt.Errorf("refusing signer: derived address %s does not match EXPECTED_SIGNER_ADDRESS", address.Hex())
	}
	return key, address, nil
}

func loadKeystore(cfg Config, readPassword PasswordReader) (*ecdsa.PrivateKey, error) {
	path, err := ResolveKeystorePath(cfg.KeystorePath, cfg.KeystoreAccount)
	if err != nil {
		return nil, err
	}
	encryptedJSON, err := os.ReadFile(path)
	if err != nil {
		return nil, fmt.Errorf("reading encrypted keystore: %w", err)
	}
	password, err := readPassword()
	if err != nil {
		return nil, fmt.Errorf("reading keystore password: %w", err)
	}
	defer clearBytes(password)
	decrypted, err := keystore.DecryptKey(encryptedJSON, string(password))
	if err != nil {
		return nil, errors.New("decrypting encrypted keystore failed")
	}
	if decrypted.PrivateKey == nil {
		return nil, errors.New("encrypted keystore contained no private key")
	}
	return decrypted.PrivateKey, nil
}

func loadRaw(raw string) (*ecdsa.PrivateKey, error) {
	raw = strings.TrimPrefix(strings.TrimPrefix(strings.TrimSpace(raw), "0x"), "0X")
	if raw == "" {
		return nil, errors.New("DEPLOYMENT_PRIVATE_KEY is required in raw signer mode")
	}
	key, err := crypto.HexToECDSA(raw)
	if err != nil {
		return nil, errors.New("invalid DEPLOYMENT_PRIVATE_KEY")
	}
	return key, nil
}

func ResolveKeystorePath(explicitPath, account string) (string, error) {
	if explicitPath != "" {
		return filepath.Clean(explicitPath), nil
	}
	if account == "" || filepath.Base(account) != account {
		return "", errors.New("DEPLOYMENT_KEYSTORE_ACCOUNT must be a keystore filename")
	}
	home, err := os.UserHomeDir()
	if err != nil {
		return "", fmt.Errorf("resolving home directory: %w", err)
	}
	return filepath.Join(home, ".foundry", "keystores", account), nil
}

func TerminalPasswordReader(input *os.File, output io.Writer) PasswordReader {
	return func() ([]byte, error) {
		if !term.IsTerminal(int(input.Fd())) {
			return nil, errors.New("interactive terminal required for encrypted keystore password")
		}
		if _, err := fmt.Fprint(output, "Keystore password: "); err != nil {
			return nil, err
		}
		password, err := term.ReadPassword(int(input.Fd()))
		_, _ = fmt.Fprintln(output)
		return password, err
	}
}

func ZeroPrivateKey(key *ecdsa.PrivateKey) { zeroPrivateKey(key) }

func zeroPrivateKey(key *ecdsa.PrivateKey) {
	if key != nil && key.D != nil {
		key.D.SetInt64(0)
	}
}

func clearBytes(value []byte) {
	for i := range value {
		value[i] = 0
	}
}
