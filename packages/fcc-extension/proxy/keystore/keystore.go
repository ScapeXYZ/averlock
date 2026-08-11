package config

import (
	"crypto/ecdsa"
	"errors"
	"fmt"
	"os"
	"strconv"
	"strings"

	"github.com/ethereum/go-ethereum/accounts/keystore"
	"github.com/ethereum/go-ethereum/common"
	"github.com/ethereum/go-ethereum/crypto"
	"golang.org/x/term"
)

var readInteractivePassword = func() ([]byte, error) {
	if !term.IsTerminal(int(os.Stdin.Fd())) {
		return nil, errors.New("interactive terminal required for proxy keystore password")
	}
	_, _ = fmt.Fprint(os.Stderr, "Proxy keystore password: ")
	password, err := term.ReadPassword(int(os.Stdin.Fd()))
	_, _ = fmt.Fprintln(os.Stderr)
	if err != nil {
		return nil, errors.New("reading proxy keystore password failed")
	}
	return password, nil
}

func privateKeyFromKeystore(actualChainID uint64) (*ecdsa.PrivateKey, error) {
	if _, set := os.LookupEnv("PROXY_PRIVATE_KEY"); set {
		return nil, errors.New("raw PROXY_PRIVATE_KEY/PRIVATE_KEY must be unset in keystore mode")
	}
	if _, set := os.LookupEnv("PRIVATE_KEY"); set {
		return nil, errors.New("raw PROXY_PRIVATE_KEY/PRIVATE_KEY must be unset in keystore mode")
	}
	expectedChain, err := strconv.ParseUint(strings.TrimSpace(os.Getenv("PROXY_EXPECTED_CHAIN_ID")), 10, 64)
	if err != nil || expectedChain == 0 || expectedChain != actualChainID {
		return nil, fmt.Errorf("refusing proxy signer: chain ID mismatch (expected %d, got %d)", expectedChain, actualChainID)
	}
	expectedRaw := strings.TrimSpace(os.Getenv("PROXY_EXPECTED_SIGNER_ADDRESS"))
	if !common.IsHexAddress(expectedRaw) || common.HexToAddress(expectedRaw) == (common.Address{}) {
		return nil, errors.New("PROXY_EXPECTED_SIGNER_ADDRESS must be a valid nonzero address")
	}
	path := strings.TrimSpace(os.Getenv("PROXY_KEYSTORE_PATH"))
	if path == "" {
		return nil, errors.New("PROXY_KEYSTORE_PATH is required in keystore mode")
	}
	encryptedJSON, err := os.ReadFile(path)
	if err != nil {
		return nil, fmt.Errorf("reading encrypted proxy keystore: %w", err)
	}
	password, err := keystorePassword()
	if err != nil {
		return nil, err
	}
	defer clearPassword(password)
	decrypted, err := keystore.DecryptKey(encryptedJSON, string(password))
	if err != nil {
		return nil, errors.New("decrypting encrypted proxy keystore failed")
	}
	address := crypto.PubkeyToAddress(decrypted.PrivateKey.PublicKey)
	if address != common.HexToAddress(expectedRaw) {
		decrypted.PrivateKey.D.SetInt64(0)
		return nil, fmt.Errorf("refusing proxy signer: derived address %s does not match expected address", address.Hex())
	}
	fmt.Fprintf(os.Stderr, "Proxy signer initialized: address=%s chain_id=%d\n", address.Hex(), actualChainID)
	return decrypted.PrivateKey, nil
}

// keystorePassword permits an unattended production launch only when the
// password is explicitly supplied as a server-side secret. Local development
// keeps the existing TTY prompt when the variable is absent.
func keystorePassword() ([]byte, error) {
	if password, ok := os.LookupEnv("PROXY_KEYSTORE_PASSWORD"); ok {
		if password == "" {
			return nil, errors.New("PROXY_KEYSTORE_PASSWORD is set but empty")
		}
		return []byte(password), nil
	}
	return readInteractivePassword()
}

func clearPassword(password []byte) {
	for i := range password {
		password[i] = 0
	}
}
