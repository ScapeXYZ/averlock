// Command tee-node starts tee-node in a process whose EXTENSION_ID has already
// been converted by the extension parent process.
package main

import (
	"os"
	"strconv"

	teeServer "github.com/flare-foundation/tee-node/pkg/server"
)

func main() {
	teeServer.StartServerExtension(intEnv("CONFIG_PORT", 5501), intEnv("SIGN_PORT", 7701), intEnv("EXTENSION_PORT", 7702))
}

func intEnv(key string, fallback int) int {
	if v, err := strconv.Atoi(os.Getenv(key)); err == nil {
		return v
	}
	return fallback
}
