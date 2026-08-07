#!/usr/bin/env bash
# Start Redis and the encrypted-keystore ext-proxy. This process deliberately
# remains in the foreground so term.ReadPassword owns the user's real terminal.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
die() { echo "[start-proxy] ERROR: $*" >&2; exit 1; }
log() { echo "[start-proxy] $*"; }

CHAIN="${CHAIN:-coston2}"
while [[ $# -gt 0 ]]; do
    case "$1" in
        --chain) [[ $# -ge 2 ]] || die "--chain requires a value"; CHAIN="$2"; shift 2 ;;
        --chain=*) CHAIN="${1#--chain=}"; shift ;;
        *) die "Unknown argument: $1" ;;
    esac
done
[[ "$CHAIN" == "coston2" ]] || die "keystore proxy startup currently requires --chain coston2"
[[ -t 0 && -t 1 && -t 2 ]] || die "Interactive TTY required for proxy keystore password. Run directly in an Ubuntu WSL terminal without pipes or redirection."

set -a
[[ ! -f "$PROJECT_DIR/.env" ]] || source "$PROJECT_DIR/.env"
[[ ! -f "$PROJECT_DIR/config/extension.env" ]] || source "$PROJECT_DIR/config/extension.env"
set +a

[[ "${PROXY_SIGNER_MODE:-${SIGNER_MODE:-keystore}}" == "keystore" ]] || die "SIGNER_MODE/PROXY_SIGNER_MODE must be keystore"
[[ -z "${PROXY_PRIVATE_KEY:-}" && -z "${PRIVATE_KEY:-}" ]] || die "PROXY_PRIVATE_KEY and PRIVATE_KEY must be unset in keystore mode"
unset PROXY_PRIVATE_KEY PRIVATE_KEY

account="${PROXY_KEYSTORE_ACCOUNT:-${DEPLOYMENT_KEYSTORE_ACCOUNT:-}}"
[[ -n "$account" && "$(basename "$account")" == "$account" ]] || die "Set PROXY_KEYSTORE_ACCOUNT to a Foundry keystore filename"
export PROXY_KEYSTORE_HOST_PATH="${PROXY_KEYSTORE_HOST_PATH:-$HOME/.foundry/keystores/$account}"
[[ -f "$PROXY_KEYSTORE_HOST_PATH" ]] || die "Encrypted proxy keystore not found: $PROXY_KEYSTORE_HOST_PATH"
[[ -n "${EXPECTED_SIGNER_ADDRESS:-}" ]] || die "EXPECTED_SIGNER_ADDRESS is required"
[[ "${EXPECTED_CHAIN_ID:-114}" == "114" ]] || die "EXPECTED_CHAIN_ID must be 114 for Coston2"

COMPOSE=(-f "$PROJECT_DIR/docker-compose.yaml" -f "$PROJECT_DIR/docker-compose.coston2.yaml" -f "$PROJECT_DIR/docker-compose.keystore.yaml")
docker compose "${COMPOSE[@]}" config --quiet || die "Docker Compose configuration is invalid"

# Remove only stale AVERLOCK proxy containers. Never use compose down here:
# Redis and the TEE must not be tied to this terminal's lifetime.
for stale in averlock-ext-proxy fcc-extension-ext-proxy-1; do
    if docker container inspect "$stale" >/dev/null 2>&1; then
        running="$(docker inspect -f '{{.State.Running}}' "$stale")"
        [[ "$running" != "true" ]] || die "Proxy container $stale is already running"
        log "Removing stale stopped proxy container: $stale"
        docker rm "$stale" >/dev/null
    fi
done

log "Starting Redis detached (no teardown trap is installed)..."
docker compose "${COMPOSE[@]}" up -d redis >/dev/null
for _ in $(seq 1 30); do
    if docker compose "${COMPOSE[@]}" exec -T redis redis-cli ping 2>/dev/null | grep -qx PONG; then
        break
    fi
    sleep 1
done
docker compose "${COMPOSE[@]}" exec -T redis redis-cli ping 2>/dev/null | grep -qx PONG || die "Redis did not return PONG"
log "Redis PONG confirmed."
log "Starting named proxy container in the foreground. Keep this terminal open."
log "Expected prompt after database initialization: Proxy keystore password:"

# No --rm: a stopped container remains available for docker logs/inspect.
# No pipe, redirect, subshell or background process may compete for this TTY.
exec docker compose "${COMPOSE[@]}" run \
    --name averlock-ext-proxy \
    --interactive \
    --no-TTY=false \
    --service-ports \
    --use-aliases \
    ext-proxy
