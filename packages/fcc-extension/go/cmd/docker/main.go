// Package main provides a combined entry point for Docker that starts both the
// tee-node server and the extension in a single process. Unlike tools/cmd/start-tee,
// this avoids importing extension-e2e — Docker sets PROXY_URL as an env var which
// tee-node reads directly via settings.init().
package main

import (
	"os"
	"os/exec"
	"os/signal"
	"strconv"
	"syscall"
	"time"

	"extension-scaffold/internal/config"
	"extension-scaffold/internal/teenode"
	extserver "extension-scaffold/pkg/server"
	"github.com/flare-foundation/go-flare-common/pkg/logger"
)

func main() {
	configPort := intEnv("CONFIG_PORT", 5501)

	// config.SignPort and config.ExtensionPort are set from SIGN_PORT and
	// EXTENSION_PORT env vars via config.init().
	signPort := config.SignPort
	extensionPort := config.ExtensionPort

	// Initialize the extension first: its Redis state store reads the Railway
	// decimal EXTENSION_ID. tee-node is then started as a child with a scoped
	// bytes32 EXTENSION_ID; this parent process is never mutated.
	extErrCh := extserver.StartExtension(extensionPort, signPort)
	teeEnv, err := teenode.EnvForCurrentProcess()
	if err != nil {
		logger.Fatalf("invalid Railway EXTENSION_ID: %v", err)
	}
	teeCmd := exec.Command("/app/tee-node")
	teeCmd.Env = teeEnv
	if err := teeCmd.Start(); err != nil {
		logger.Fatalf("start tee-node: %v", err)
	}
	teeErrCh := make(chan error, 1)
	go func() { teeErrCh <- teeCmd.Wait() }()

	// Give server a moment to bind, then check for early failures.
	time.Sleep(100 * time.Millisecond)
	select {
	case err := <-extErrCh:
		logger.Fatalf("extension server failed to start: %v", err)
	default:
	}

	logger.Infof("extension TEE running (config=%d, sign=%d, ext=%d)", configPort, signPort, extensionPort)

	// Wait for signal or server error.
	sigChan := make(chan os.Signal, 1)
	signal.Notify(sigChan, os.Interrupt, syscall.SIGTERM)
	select {
	case <-sigChan:
		logger.Info("shutting down")
	case err := <-extErrCh:
		logger.Fatalf("extension server error: %v", err)
	case err := <-teeErrCh:
		logger.Fatalf("tee-node exited: %v", err)
	}
	_ = teeCmd.Process.Signal(syscall.SIGTERM)
}

func intEnv(key string, fallback int) int {
	if v, err := strconv.Atoi(os.Getenv(key)); err == nil {
		return v
	}
	return fallback
}
