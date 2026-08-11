// Package teenode prepares the isolated environment used by the tee-node child.
package teenode

import (
	"fmt"
	"math/big"
	"os"
	"strings"
)

const ExtensionIDEnv = "EXTENSION_ID"

// ExtensionIDBytes32 converts a positive base-10 extension ID to tee-node's
// required 0x-prefixed, 32-byte hexadecimal representation.
func ExtensionIDBytes32(decimal string) (string, error) {
	decimal = strings.TrimSpace(decimal)
	if decimal == "" {
		return "", fmt.Errorf("EXTENSION_ID must be a positive decimal integer")
	}
	for _, c := range decimal {
		if c < '0' || c > '9' {
			return "", fmt.Errorf("EXTENSION_ID must be a positive decimal integer")
		}
	}
	n, ok := new(big.Int).SetString(decimal, 10)
	if !ok || n.Sign() <= 0 {
		return "", fmt.Errorf("EXTENSION_ID must be a positive decimal integer")
	}
	if n.BitLen() > 256 {
		return "", fmt.Errorf("EXTENSION_ID exceeds 32 bytes")
	}
	return fmt.Sprintf("0x%064x", n), nil
}

// ChildEnv returns an environment that differs from the extension process only
// in EXTENSION_ID. The parent environment is deliberately never modified.
func ChildEnv(parent []string, extensionID string) ([]string, error) {
	hexID, err := ExtensionIDBytes32(extensionID)
	if err != nil {
		return nil, err
	}
	env := make([]string, 0, len(parent)+1)
	found := false
	for _, entry := range parent {
		if strings.HasPrefix(entry, ExtensionIDEnv+"=") {
			env = append(env, ExtensionIDEnv+"="+hexID)
			found = true
			continue
		}
		env = append(env, entry)
	}
	if !found {
		env = append(env, ExtensionIDEnv+"="+hexID)
	}
	return env, nil
}

// EnvForCurrentProcess is the child environment for the Railway-facing
// EXTENSION_ID, while preserving the current process's decimal value.
func EnvForCurrentProcess() ([]string, error) {
	return ChildEnv(os.Environ(), os.Getenv(ExtensionIDEnv))
}
