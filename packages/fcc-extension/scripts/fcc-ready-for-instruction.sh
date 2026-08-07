#!/usr/bin/env bash
# Fail-closed readiness gate for a live AVERLOCK FCC instruction.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
TOOLS_DIR="$PROJECT_DIR/tools"

EXPECTED_TEE="${EXPECTED_TEE_ID:?Set EXPECTED_TEE_ID to the TEE derived from the permanent proxy /info response}"
EXPECTED_OWNER="${EXPECTED_SIGNER_ADDRESS:?Set EXPECTED_SIGNER_ADDRESS to the registered TEE owner}"
EXPECTED_EXTENSION_RAW="${EXPECTED_EXTENSION_ID:-65927}"
EXPECTED_URL="${EXPECTED_PROXY_URL:?Set EXPECTED_PROXY_URL to the permanent HTTPS proxy origin}"
RPC_URL="${CHAIN_URL:-https://coston2-api.flare.network/ext/C/rpc}"
MANAGER="${FLARE_TEE_MANAGER:-0x1a9C4A0f9D76c0b1D91d22E24E573a9b377618aE}"
RELAY="${FLARE_RELAY:-0xa10B672D1c62e5457b17af63d4302add6A99d7dE}"
PROXY_NAME="${AVERLOCK_PROXY_CONTAINER:-averlock-ext-proxy}"
TEE_NAME="${AVERLOCK_TEE_CONTAINER:-fcc-extension-extension-tee-1}"
REDIS_NAME="${AVERLOCK_REDIS_CONTAINER:-fcc-extension-redis-1}"

die() { echo "[fcc-ready] NOT READY: $*" >&2; exit 1; }
need() { command -v "$1" >/dev/null 2>&1 || die "$1 is required"; }
need curl
need jq
need cast
need docker

# pre-build writes EXTENSION_ID as a bytes32-style hex value, while the FCC
# registry getters return uint256 in decimal. Canonicalize both forms before
# comparing them so 65927, 0x10187, and the zero-padded bytes32 encoding are
# the same extension without weakening the equality check.
normalize_extension_id() {
    local value="$1"
    if [[ "$value" =~ ^0[xX][0-9a-fA-F]+$ ]]; then
        cast to-dec "$value" 2>/dev/null || die "invalid hexadecimal extension ID ($value)"
    elif [[ "$value" =~ ^[0-9]+$ ]]; then
        # Strip decimal leading zeroes without shell integer-width arithmetic.
        value="${value#${value%%[!0]*}}"
        echo "${value:-0}"
    else
        die "invalid extension ID representation ($value)"
    fi
}

EXPECTED_EXTENSION="$(normalize_extension_id "$EXPECTED_EXTENSION_RAW")"
# cast emits a canonical quantity; pad it for /info's bytes32 representation.
extension_quantity="$(cast to-hex "$EXPECTED_EXTENSION")"
extension_digits="${extension_quantity#0x}"
printf -v EXPECTED_EXTENSION_HEX '0x%064s' "$extension_digits"
EXPECTED_EXTENSION_HEX="${EXPECTED_EXTENSION_HEX// /0}"

"$SCRIPT_DIR/proxy-health.sh" full >/dev/null || die "proxy FULL_READY check failed"
[[ "$(docker inspect -f '{{.State.Running}}' "$PROXY_NAME" 2>/dev/null || true)" == "true" ]] || die "proxy container is not running"
[[ "$(docker inspect -f '{{.State.Running}}' "$TEE_NAME" 2>/dev/null || true)" == "true" ]] || die "extension-tee container is not running"
[[ "$(docker inspect -f '{{.State.Running}}' "$REDIS_NAME" 2>/dev/null || true)" == "true" ]] || die "Redis container is not running"
[[ "$(docker exec "$REDIS_NAME" redis-cli ping 2>/dev/null)" == "PONG" ]] || die "Redis did not return PONG"
docker exec "$REDIS_NAME" wget -qO- --timeout=6 "http://$TEE_NAME:7702/ready" 2>/dev/null \
    | grep -Fq '"status":"ready"' \
    || die "internal action service or GuardManager RPC dependency is not ready"

logs="$(docker logs "$PROXY_NAME" 2>&1)"
grep -Fq "Database in sync" <<<"$logs" || die "proxy database synchronization is not confirmed"
grep -Fq "wallet sync done" <<<"$logs" || die "proxy wallet synchronization is incomplete"

local_info="$(curl -fsS --max-time 5 http://127.0.0.1:6674/info)" || die "local /info is unavailable"
public_info="$(curl -fsS --max-time 10 "$EXPECTED_URL/info")" || die "registered public /info is unavailable"
local_extension="$(jq -r '.machineData.extensionId' <<<"$local_info")"
public_extension="$(jq -r '.machineData.extensionId' <<<"$public_info")"
[[ "$local_extension" == "$public_extension" ]] || die "local/public extension metadata differ"
[[ "${local_extension,,}" == "${EXPECTED_EXTENSION_HEX,,}" ]] || die "unexpected extension ID in /info"

(cd "$TOOLS_DIR" && go run ./cmd/verify-live-info -proxy http://127.0.0.1:6674 -tee "$EXPECTED_TEE") >/dev/null \
    || die "local /info does not derive to expected TEE"
(cd "$TOOLS_DIR" && go run ./cmd/verify-live-info -proxy "$EXPECTED_URL" -tee "$EXPECTED_TEE") >/dev/null \
    || die "public /info does not derive to expected TEE"

unset CHAIN || true
machine="$(cast call --chain flare-coston2 --rpc-url "$RPC_URL" "$MANAGER" 'getTeeMachine(address)((address,address,string))' "$EXPECTED_TEE")" \
    || die "getTeeMachine failed"
grep -Fqi "$EXPECTED_OWNER" <<<"$machine" || die "registered proxy signer/owner mismatch"
grep -Fq "\"$EXPECTED_URL\"" <<<"$machine" || die "registered URL mismatch"
status="$(cast call --chain flare-coston2 --rpc-url "$RPC_URL" "$MANAGER" 'getTeeMachineStatus(address)(uint8)' "$EXPECTED_TEE" | awk '{print $1}')"
[[ "$status" == "2" ]] || die "expected TEE is not PRODUCTION (status=$status)"
extension_raw="$(cast call --chain flare-coston2 --rpc-url "$RPC_URL" "$MANAGER" 'getExtensionId(address)(uint256)' "$EXPECTED_TEE" | awk '{print $1}')"
extension="$(normalize_extension_id "$extension_raw")"
[[ "$extension" == "$EXPECTED_EXTENSION" ]] \
    || die "onchain extension mismatch (expected=$EXPECTED_EXTENSION raw_expected=$EXPECTED_EXTENSION_RAW actual=$extension raw_actual=$extension_raw)"

# InstructionSender chooses getRandomTeeIds(extension, 1). A preflight is safe
# only when the registry's selectable set contains exactly the live expected
# TEE. Otherwise a transaction can irreversibly target an obsolete machine.
active="$(cd "$TOOLS_DIR" && go run ./cmd/query-tee -ext "$EXPECTED_EXTENSION" -reg "$MANAGER" -rpc "$RPC_URL")" \
    || die "cannot query active TEE set"
active_count="$(grep -Ec '^  [0-9]+: 0x' <<<"$active" || true)"
[[ "$active_count" == "1" ]] || die "extension has $active_count selectable TEEs; expected exactly one"
grep -Fqi "$EXPECTED_TEE" <<<"$active" || die "sole selectable TEE is not the expected live TEE"

last_info="$(jq -r '.teeInfo.lastSigningPolicyId' <<<"$local_info")"
relay_info="$(cast call --chain flare-coston2 --rpc-url "$RPC_URL" "$RELAY" 'lastInitializedRewardEpochData()(uint32,uint32)')" || die "Relay policy query failed"
last_chain="$(awk 'NR==1 {print $1}' <<<"$relay_info")"
[[ "$last_info" == "$last_chain" ]] || die "proxy policy $last_info is not synchronized with onchain policy $last_chain"
grep -Fq "creating round for $last_info" <<<"$logs" || die "proxy has not created the current instruction round"

# Prove that the current round is resident. A zero ID must return the specific
# 'no instruction' response, not 'round not stored'.
round_body="$(curl -sS --max-time 5 "http://127.0.0.1:6674/action/status/$last_info/0x0000000000000000000000000000000000000000000000000000000000000000")"
grep -Fq "no instruction with the provided id" <<<"$round_body" || die "current instruction round is not resident"

# Query private extension state through the existing Docker-only network.
state="$(docker exec "$REDIS_NAME" wget -qO- "http://$TEE_NAME:7702/state")" || die "extension state endpoint is unreachable"
policy_count="$(jq -r '.state.policyCount' <<<"$state")"
[[ "$policy_count" == "0" ]] || die "extension policyCount is $policy_count, expected 0 before restore"

if [[ -n "${PREVIOUS_RESTORE_ACTION_ID:-}" ]]; then
    prior="$(cd "$TOOLS_DIR" && go run ./cmd/inspect-instruction -action "$PREVIOUS_RESTORE_ACTION_ID" -lookback 10000)" \
        || die "cannot inspect previous restore instruction"
    if grep -Fqi "TARGET_TEE tee=$EXPECTED_TEE" <<<"$prior"; then
        prior_code="$(curl -sS -o /dev/null -w '%{http_code}' --max-time 5 \
            "http://127.0.0.1:6674/action/result/$PREVIOUS_RESTORE_ACTION_ID?submissionTag=threshold")"
        [[ "$prior_code" == "200" ]] || die "previous restore targets current TEE and remains unresolved"
    fi
fi

# Require a stable policy/TEE selection window, not a transition between two
# initialized policies. Waiting for last+1 to appear onchain is the proxy's
# normal steady state; equality of /info and Relay on both probes is decisive.
sleep "${READINESS_STABILITY_SECONDS:-10}"
second_info="$(curl -fsS --max-time 5 http://127.0.0.1:6674/info)" || die "local /info disappeared during stability check"
second_last="$(jq -r '.teeInfo.lastSigningPolicyId' <<<"$second_info")"
second_chain="$(cast call --chain flare-coston2 --rpc-url "$RPC_URL" "$RELAY" 'lastInitializedRewardEpochData()(uint32,uint32)' | awk 'NR==1 {print $1}')" \
    || die "second Relay policy query failed"
[[ "$second_last" == "$last_info" && "$second_chain" == "$last_chain" ]] \
    || die "signing policy changed during readiness window ($last_info/$last_chain -> $second_last/$second_chain)"

echo "READY_FOR_INSTRUCTION tee=$EXPECTED_TEE extensionId=$EXPECTED_EXTENSION signingPolicy=$last_info policyCount=0"
