# AVERLOCK event indexer

This service indexes **only** the deployed AVERLOCK `BaseGuardManager` and `BaseProtectionVault`
events. It does not index Base generally and is never a prerequisite for contract reads
or the web application's readiness.

It starts at `AVERLOCK_START_BLOCK`, calls `eth_getLogs` with configured address and event
topic filters, and persists a minimal SQLite database: indexed events plus one cursor. Event
writes are idempotent on `(transaction_hash, log_index)`. The cursor is advanced only after a
complete range is committed.

The filtered Base log range is configurable with `AVERLOCK_LOG_BLOCK_RANGE` and defaults to 2,000.

All JSON-RPC calls share a global `AVERLOCK_RPC_REQUESTS_PER_SECOND` limiter (default `2`). A
429 honors `Retry-After` when supplied, otherwise retries with exponential backoff and jitter;
`/health` and `/sync` report `fatal_configuration_error`, `rate_limited`, `retrying`, `syncing`,
or `healthy` explicitly.

`AVERLOCK_CONFIRMATIONS` defaults to 12. Every run rewinds the persisted cursor by
`AVERLOCK_REORG_OVERLAP` (default 24) before resuming, deletes only that overlap's derived
events, and replays it. This makes short Base reorgs safe without claiming the service is
at the chain head.

Endpoints:

- `GET /health` — process and database health; never reports fully ready merely because it is alive.
- `GET /sync` — honest indexed block, safe chain head, and lag.
- `GET /activity?owner=0x...` — public AVERLOCK history for one owner.
- `GET /guards?owner=0x...` — receipt anchors for the Guards page.

Run locally with `npm run start --workspace @averlock/event-indexer` after setting the variables
in `.env.example`. Set `BASE_SEPOLIA_LIVE_RPC_TEST=1` and run
`npm run test:base-rpc --workspace @averlock/event-indexer` for a live Base Sepolia request.
