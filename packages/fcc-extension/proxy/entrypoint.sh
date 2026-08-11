#!/bin/sh
set -eu

fail() {
  echo "proxy keystore bootstrap: $*" >&2
  exit 1
}

# Keystore mode is intentionally the only production mode.  Treat even empty
# raw-key variables as configuration errors so they cannot become a fallback.
[ "${PROXY_SIGNER_MODE:-keystore}" = "keystore" ] || fail "PROXY_SIGNER_MODE must be keystore"
[ -z "${PROXY_PRIVATE_KEY+x}" ] || fail "PROXY_PRIVATE_KEY must be unset in keystore mode"
[ -z "${PRIVATE_KEY+x}" ] || fail "PRIVATE_KEY must be unset in keystore mode"
[ "${PROXY_EXPECTED_CHAIN_ID:?PROXY_EXPECTED_CHAIN_ID is required}" = "114" ] || fail "PROXY_EXPECTED_CHAIN_ID must be 114"
[ -n "${PROXY_EXPECTED_SIGNER_ADDRESS:-}" ] || fail "PROXY_EXPECTED_SIGNER_ADDRESS is required"
[ "${PROXY_KEYSTORE_PATH:-}" = "/data/proxy-keystore.json" ] || fail "PROXY_KEYSTORE_PATH must be /data/proxy-keystore.json"
[ -n "${PROXY_KEYSTORE_PASSWORD:-}" ] || fail "PROXY_KEYSTORE_PASSWORD is required"
export PROXY_SIGNER_MODE=keystore

keystore_path=/data/proxy-keystore.json
if [ ! -f "$keystore_path" ]; then
  [ -n "${PROXY_KEYSTORE_BOOTSTRAP_PRIVATE_KEY:-}" ] || fail "keystore is missing and PROXY_KEYSTORE_BOOTSTRAP_PRIVATE_KEY is not set"
  derived_address=$(/app/proxy-keystore bootstrap --path "$keystore_path") || fail "keystore initialization failed"
  [ "$(printf '%s' "$derived_address" | tr '[:upper:]' '[:lower:]')" = "$(printf '%s' "$PROXY_EXPECTED_SIGNER_ADDRESS" | tr '[:upper:]' '[:lower:]')" ] || fail "derived signer address does not match PROXY_EXPECTED_SIGNER_ADDRESS"
  # Log only the public address after initialization.
  echo "$derived_address" >&2
fi

# Bootstrap material is never inherited by the long-running proxy process.
unset PROXY_KEYSTORE_BOOTSTRAP_PRIVATE_KEY

# Validate the encrypted file and its signer before tee-proxy starts.  The
# patched proxy repeats this validation when it loads the in-memory signer.
derived_address=$(/app/proxy-keystore verify --path "$keystore_path" --expected-address "$PROXY_EXPECTED_SIGNER_ADDRESS") || fail "keystore validation failed"

cat > /app/config/config.toml <<CFG
redis_port = "${REDIS_HOST}:${REDIS_PORT}"
initial_signing_policy_offset = 2
signing_policy_fetch_interval = "20s"

chain_id = 114

[db]
host = "${DB_HOST}"
port = ${DB_PORT}
database = "${DB_DATABASE}"
username = "${DB_USERNAME}"
password = "${DB_PASSWORD}"
log_queries = false

[addresses]
flare_systems_manager = "0xA90Db6D10F856799b10ef2A77EBCbF460aC71e52"
relay = "0xa10B672D1c62e5457b17af63d4302add6A99d7dE"
voter_registry = "0x6a0AF07b7972177B176d3D422555cbc98DfDe914"

[ports]
internal = "6663"
external = "6664"

[info_timing]
cycle_internal = "10s"
cycle_queue_response_wait = "2s"

[voting]
proposal_expiration = "12s"
max_pending_request = 10000
CFG

exec ./main
