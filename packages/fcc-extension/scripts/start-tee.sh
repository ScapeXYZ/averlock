#!/usr/bin/env bash
# Start extension-tee after proxy bootstrap readiness, then wait for the proxy's
# TEE-dependent full readiness.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
die() { echo "[start-tee] ERROR: $*" >&2; exit 1; }
CHAIN="${CHAIN:-coston2}"
while [[ $# -gt 0 ]]; do
    case "$1" in
        --chain) [[ $# -ge 2 ]] || die "--chain requires a value"; CHAIN="$2"; shift 2 ;;
        --chain=*) CHAIN="${1#--chain=}"; shift ;;
        *) die "Unknown argument: $1" ;;
    esac
done
[[ "$CHAIN" == "coston2" ]] || die "TEE startup currently requires --chain coston2"

set -a
[[ ! -f "$PROJECT_DIR/.env" ]] || source "$PROJECT_DIR/.env"
[[ ! -f "$PROJECT_DIR/config/extension.env" ]] || source "$PROJECT_DIR/config/extension.env"
set +a
export PROXY_KEYSTORE_HOST_PATH="${PROXY_KEYSTORE_HOST_PATH:-$HOME/.foundry/keystores/${PROXY_KEYSTORE_ACCOUNT:-${DEPLOYMENT_KEYSTORE_ACCOUNT:-averlock-fcc}}}"
COMPOSE=(-f "$PROJECT_DIR/docker-compose.yaml" -f "$PROJECT_DIR/docker-compose.coston2.yaml" -f "$PROJECT_DIR/docker-compose.keystore.yaml")

"$SCRIPT_DIR/proxy-health.sh" bootstrap || die "proxy bootstrap health gate failed; extension-tee was not started"

# tee-node v0.0.24 intentionally generates a fresh TEE identity on every boot.
# Never rebuild/recreate a running TEE after the proxy has cached its TEE_INFO:
# doing so changes teeId mid-session and every new response is rejected.
if [[ "$(docker inspect -f '{{.State.Running}}' fcc-extension-extension-tee-1 2>/dev/null || true)" == "true" ]]; then
    echo "[start-tee] extension-tee already running; preserving its current TEE identity"
else
    docker compose "${COMPOSE[@]}" up -d --no-deps extension-tee
    echo "[start-tee] extension-tee started from the existing image; waiting for proxy FULL_READY"
fi

for _ in $(seq 1 60); do
    state="$(docker inspect -f '{{.State.Status}}' fcc-extension-extension-tee-1 2>/dev/null || true)"
    [[ "$state" == "running" ]] && break
    [[ "$state" != "exited" ]] || { docker logs --tail 100 fcc-extension-extension-tee-1 >&2; die "extension-tee exited"; }
    sleep 1
done
[[ "$(docker inspect -f '{{.State.Running}}' fcc-extension-extension-tee-1 2>/dev/null || true)" == "true" ]] || die "extension-tee is not running"

# FULL_READY proves proxy/TEE metadata, but funded AVERLOCK evaluations also
# require the internal extension server and its GuardManager RPC dependency.
# Query from another container on the same Docker network because the TEE image
# is intentionally distroless and has no shell or curl binary.
action_ready=false
for _ in $(seq 1 30); do
    if docker exec fcc-extension-redis-1 wget -qO- --timeout=6 \
        "http://fcc-extension-extension-tee-1:7702/ready" 2>/dev/null | grep -Fq '"status":"ready"'; then
        action_ready=true
        break
    fi
    [[ "$(docker inspect -f '{{.State.Running}}' fcc-extension-extension-tee-1 2>/dev/null || true)" == "true" ]] \
        || die "extension-tee stopped before its action service became ready"
    sleep 1
done
[[ "$action_ready" == "true" ]] || die "internal extension action service or GuardManager RPC dependency is not ready"
echo "[start-tee] internal action service READY on :7702"

network="$(docker inspect -f '{{range $k, $v := .NetworkSettings.Networks}}{{$k}}{{end}}' averlock-ext-proxy)"
docker inspect -f '{{range $k, $v := .NetworkSettings.Networks}}{{range $v.Aliases}}{{println .}}{{end}}{{end}}' averlock-ext-proxy | grep -qx ext-proxy || die "proxy lacks ext-proxy DNS alias"
docker inspect -f '{{range $k, $v := .NetworkSettings.Networks}}{{$k}}{{end}}' fcc-extension-extension-tee-1 | grep -qx "$network" || die "TEE and proxy are not on the same Docker network"

full_ready=false
for _ in $(seq 1 120); do
    if "$SCRIPT_DIR/proxy-health.sh" full >/dev/null 2>&1; then
        full_ready=true
        break
    fi
    [[ "$(docker inspect -f '{{.State.Running}}' fcc-extension-extension-tee-1 2>/dev/null || true)" == "true" ]] || {
        docker logs --tail 100 fcc-extension-extension-tee-1 >&2
        die "extension-tee stopped before proxy reached FULL_READY"
    }
    sleep 1
done
[[ "$full_ready" == "true" ]] || {
    "$SCRIPT_DIR/proxy-health.sh" full || true
    die "proxy did not reach FULL_READY within 120 seconds"
}

"$SCRIPT_DIR/proxy-health.sh" full
echo "[start-tee] READY: extension-tee is running on $network; Docker network alias ext-proxy resolves to the proxy service on :6663"
echo "[start-tee] No teardown trap is installed; Redis and extension-tee remain detached."
