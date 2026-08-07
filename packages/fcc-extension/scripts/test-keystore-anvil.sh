#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
export PATH="$HOME/.foundry/bin:$PATH"

anvil --silent --port 8547 >/dev/null 2>&1 &
anvil_pid=$!
cleanup() { kill "$anvil_pid" 2>/dev/null || true; }
trap cleanup EXIT

for _ in {1..30}; do
    if cast chain-id --rpc-url http://127.0.0.1:8547 >/dev/null 2>&1; then
        break
    fi
    sleep 0.2
done

cd "$PROJECT_DIR/tools"
ANVIL_RPC_URL=http://127.0.0.1:8547 \
    go test -count=1 -tags integration ./pkg/signer \
    -run TestEncryptedKeystoreSignsLocalAnvilTransaction -v
