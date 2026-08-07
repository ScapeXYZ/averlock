#!/usr/bin/env bash
# Read-only staged health gate for the proxy/TEE bootstrap cycle.
set -euo pipefail

NAME="${AVERLOCK_PROXY_CONTAINER:-averlock-ext-proxy}"
EXPECTED_ADDRESS="${EXPECTED_SIGNER_ADDRESS:-0x8E4f5D2736B988D4e922b988FF89bcCde45C6f2f}"
die() { echo "[proxy-health] NOT READY: $*" >&2; exit 1; }
LEVEL="${1:-full}"
case "$LEVEL" in
    bootstrap|full) ;;
    *) die "usage: proxy-health.sh [bootstrap|full]" ;;
esac

[[ "$(docker inspect -f '{{.State.Running}}' "$NAME" 2>/dev/null || true)" == "true" ]] || die "$NAME is not running"
logs="$(docker logs "$NAME" 2>&1)"
grep -Fq "Database in sync" <<<"$logs" || die "database sync confirmation missing"
grep -Fq "Proxy signer initialized" <<<"$logs" || die "signer initialization missing"
grep -Fqi "address=$EXPECTED_ADDRESS" <<<"$logs" || die "expected signer address missing"
grep -Fq "chain_id=114" <<<"$logs" || die "chain ID 114 confirmation missing"
grep -Fq "persistent storage backend: Redis" <<<"$logs" || die "Redis backend confirmation missing"
grep -Fq "serving internal at :6663" <<<"$logs" || die "internal listener confirmation missing"

if [[ "$LEVEL" == "bootstrap" ]]; then
    echo "[proxy-health] BOOTSTRAP_READY: signer=$EXPECTED_ADDRESS chain_id=114 Redis=connected internal=:6663"
    exit 0
fi

command -v jq >/dev/null 2>&1 || die "jq is required for live /info validation"
info="$(curl -fsS --max-time 5 http://127.0.0.1:6674/info)" || die "external :6664 /info is not HTTP-successful"

# Live /info is authoritative for current-session readiness. Do not depend on
# historical wording in proxy logs: it may change between tee-proxy releases,
# and signing-policy progression can legitimately continue after TEE_INFO is
# initialized.
jq -e '
    .teeInfo != null
    and .teeInfo.chainId == 114
    and (.teeInfo.teeTimestamp | type == "number" and . > 0)
    and (.teeInfo.publicKey.x | type == "string" and test("^0x[0-9a-fA-F]{64}$") and test("^0x0{64}$") | not)
    and (.teeInfo.publicKey.y | type == "string" and test("^0x[0-9a-fA-F]{64}$") and test("^0x0{64}$") | not)
    and .machineData != null
    and (.machineData.extensionId | type == "string" and test("^0x[0-9a-fA-F]{64}$") and test("^0x0{64}$") | not)
' >/dev/null <<<"$info" || die "live /info lacks valid current TEE metadata"

echo "[proxy-health] FULL_READY: signer=$EXPECTED_ADDRESS chain_id=114 Redis=connected internal=:6663 external=:6664 /info=ok"
