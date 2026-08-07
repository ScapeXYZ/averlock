#!/usr/bin/env bash
# Starts the proxy in the foreground so its in-container password prompt is
# connected directly to the user's terminal. No password crosses env, args, or disk.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"

if [[ -f "$PROJECT_DIR/.env" ]]; then
    set -a
    source "$PROJECT_DIR/.env"
    set +a
fi

[[ "${PROXY_SIGNER_MODE:-keystore}" == "keystore" ]] || {
    echo "This wrapper is only for PROXY_SIGNER_MODE=keystore" >&2
    exit 1
}

account="${PROXY_KEYSTORE_ACCOUNT:-${DEPLOYMENT_KEYSTORE_ACCOUNT:-}}"
[[ -n "$account" && "$(basename "$account")" == "$account" ]] || {
    echo "Set PROXY_KEYSTORE_ACCOUNT to a Foundry keystore filename" >&2
    exit 1
}

keystore_path="${PROXY_KEYSTORE_HOST_PATH:-$HOME/.foundry/keystores/$account}"
[[ -f "$keystore_path" ]] || {
    echo "Encrypted keystore not found: $keystore_path" >&2
    exit 1
}

export PROXY_KEYSTORE_HOST_PATH="$keystore_path"
export PROXY_SIGNER_MODE=keystore

echo "Starting redis and ext-proxy in the foreground."
echo "Enter the keystore password only at the in-container prompt."
echo "After initialization, keep this terminal attached while the proxy runs."
exec docker compose \
    -f "$PROJECT_DIR/docker-compose.yaml" \
    -f "$PROJECT_DIR/docker-compose.coston2.yaml" \
    -f "$PROJECT_DIR/docker-compose.keystore.yaml" \
    up redis ext-proxy
