#!/usr/bin/env bash
# One-shot Phase 6.3 finalization: obtain a snapshot-derived FCC authorization,
# simulate approve+execute, broadcast only after simulation succeeds, then verify.
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
FCC_DIR="$ROOT_DIR/packages/fcc-extension"
CONTRACTS_DIR="$ROOT_DIR/packages/contracts"
RPC_URL="https://coston2-api.flare.network/ext/C/rpc"
TEE_ID="0xD81a049D4989671c6F8A3d724f696aaA4dA5a484"
MANAGER="0x444947Aaa00aB3fddbeb6421244A160448E6B52D"
RULE="0x2a3a9591def2b67120f829c342d002de5e2def49ac0f4044a6be143071489400"
EVENT="0xc4d12008caea289e8809d9f2884522ed85aac29600e43d1f07a566c896514819"
ARTIFACT="../data/phase63-action-result.local.json"
TOKEN="0x0b6A3645c240605887a5532109323A3E12273dc7"
OWNER="0x8E4f5D2736B988D4e922b988FF89bcCde45C6f2f"
TEE_MANAGER="0x1a9C4A0f9D76c0b1D91d22E24E573a9b377618aE"

die() { echo "[phase63-final] ERROR: $*" >&2; exit 1; }

echo "[phase63-final] checking immutable live preconditions"
docker exec fcc-extension-redis-1 wget -qO- --timeout=6 \
    http://fcc-extension-extension-tee-1:7702/ready 2>/dev/null | grep -Fq '"status":"ready"' \
    || die "internal action service/GuardManager RPC readiness check failed"
policy_count="$(docker exec fcc-extension-redis-1 wget -qO- \
    http://fcc-extension-extension-tee-1:7702/state | jq -r '.state.policyCount')"
[[ "$policy_count" == "1" ]] || die "live policyCount is $policy_count, expected 1"
[[ "$(cast call --chain flare-coston2 --rpc-url "$RPC_URL" "$MANAGER" \
    'isEventConsumed(bytes32)(bool)' "$EVENT")" == "false" ]] || die "event is already consumed"
[[ "$(cast call --chain flare-coston2 --rpc-url "$RPC_URL" "$TEE_MANAGER" \
    'getTeeMachineStatus(address)(uint8)' "$TEE_ID" | awk '{print $1}')" == "2" ]] \
    || die "current TEE is not PRODUCTION"
[[ "$(cast call --chain flare-coston2 --rpc-url "$RPC_URL" "$TEE_MANAGER" \
    'getExtensionId(address)(uint256)' "$TEE_ID" | awk '{print $1}')" == "65927" ]] \
    || die "current TEE extension mismatch"
active_tees="$(cd "$FCC_DIR/tools" && go run ./cmd/query-tee -ext 65927 -reg "$TEE_MANAGER" -rpc "$RPC_URL")"
[[ "$(grep -Ec '^  [0-9]+: 0x' <<<"$active_tees" || true)" == "1" ]] \
    || die "extension 65927 does not have exactly one selectable TEE"
grep -Fqi "$TEE_ID" <<<"$active_tees" || die "current TEE is not the sole selectable TEE"
wallet_balance="$(cast call --chain flare-coston2 --rpc-url "$RPC_URL" "$TOKEN" \
    'balanceOf(address)(uint256)' "$OWNER" | awk '{print $1}')"
(( wallet_balance >= 700000000 )) || die "insufficient FTestXRP balance ($wallet_balance)"

echo "[phase63-final] obtaining one fresh snapshot-derived FCC authorization"
(
    cd "$FCC_DIR"
    TEE_ID="$TEE_ID" \
    CHAIN_URL="$RPC_URL" \
    EXT_PROXY_URL="https://crescentoid-earless-kelsi.ngrok-free.dev" \
    RESULT_PROXY_URL="http://127.0.0.1:6674" \
    ./scripts/test.sh \
        -evaluateGuardSnapshot \
        -guardManager "$MANAGER" \
        -ruleId "$RULE" \
        -eventHash "$EVENT" \
        -resultArtifact "$ARTIFACT"
)

echo "[phase63-final] simulating exact approval and executeGuard"
(
    cd "$CONTRACTS_DIR"
    forge script script/ExecutePhase63Final.s.sol:ExecutePhase63Final \
        --rpc-url "$RPC_URL" \
        --sender 0x8E4f5D2736B988D4e922b988FF89bcCde45C6f2f \
        -vvvv
)

echo "[phase63-final] simulation passed; broadcasting exact approval and executeGuard"
(
    cd "$CONTRACTS_DIR"
    forge script script/ExecutePhase63Final.s.sol:ExecutePhase63Final \
        --rpc-url "$RPC_URL" \
        --account averlock-fcc \
        --broadcast \
        --slow \
        -vvvv
)

echo "[phase63-final] verifying live vault position, balances, consumption, and replay rejection"
(
    cd "$CONTRACTS_DIR"
    forge script script/VerifyPhase63Final.s.sol:VerifyPhase63Final \
        --rpc-url "$RPC_URL" \
        -vvvv
)
