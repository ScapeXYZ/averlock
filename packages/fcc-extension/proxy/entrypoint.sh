#!/bin/sh
set -eu

fail() {
  echo "proxy keystore bootstrap: $*" >&2
  exit 1
}

keystore_path=/data/proxy-keystore.json

# Railway mounts volumes after the image filesystem is assembled and they can
# therefore arrive owned by root.  This is the only root-only phase.  It never
# creates, replaces, or reads keystore contents; it makes the mounted
# directory and a pre-existing keystore usable by the dedicated runtime user.
if [ "${1:-}" != "--run-as-appuser" ]; then
  [ "$(id -u)" = "0" ] || fail "entrypoint must start as root to prepare /data"
  mkdir -p /data || fail "cannot create /data"
  chown 1001:1001 /data || fail "cannot set owner on /data"
  chmod 0700 /data || fail "cannot secure /data"
  if [ -e "$keystore_path" ] || [ -L "$keystore_path" ]; then
    [ ! -L "$keystore_path" ] || fail "keystore path must not be a symlink: $keystore_path"
    [ -f "$keystore_path" ] || fail "keystore path is not a regular file: $keystore_path"
    # Preserve the encrypted bytes while restoring the permissions required by
    # the non-root runtime user on a previously provisioned volume.
    chown 1001:1001 "$keystore_path" || fail "cannot set owner on existing keystore: $keystore_path"
    chmod 0600 "$keystore_path" || fail "cannot secure existing keystore: $keystore_path"
  fi
  exec su-exec 1001:1001 /app/entrypoint.sh --run-as-appuser
fi

[ "$(id -u)" = "1001" ] || fail "keystore bootstrap must run as UID 1001"
[ "$(id -g)" = "1001" ] || fail "keystore bootstrap must run as GID 1001"
[ -d /data ] || fail "/data does not exist"
[ -w /data ] || fail "/data is not writable by UID 1001"

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

keystore_state=existing-preserved
if [ ! -f "$keystore_path" ]; then
  keystore_state=created
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
[ "$(stat -c '%a' "$keystore_path")" = "600" ] || fail "keystore mode must be 0600: $keystore_path"
echo "proxy keystore volume ready: /data writable by 1001:1001; keystore=${keystore_state}; mode=0600" >&2

if [ -n "${REDIS_URL:-}" ]; then
  case "$REDIS_URL" in
    redis://*:*@*|rediss://*:*@*) ;;
    redis://*|rediss://*) fail "REDIS_URL must include Redis credentials" ;;
    *) fail "REDIS_URL must use the redis:// or rediss:// scheme" ;;
  esac
  redis_port=$REDIS_URL
  echo "redis authentication configured" >&2
else
  : "${REDIS_HOST:?REDIS_HOST is required when REDIS_URL is unset}"
  : "${REDIS_PORT:?REDIS_PORT is required when REDIS_URL is unset}"
  redis_port="${REDIS_HOST}:${REDIS_PORT}"
fi

# Redis URLs contain credentials. Keep the generated runtime config readable
# only by the dedicated proxy user.
umask 077
cat > /app/config/config.toml <<CFG
redis_port = "${redis_port}"
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
