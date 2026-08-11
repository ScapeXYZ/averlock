# AVERLOCK event indexer

This service indexes **only** the deployed AVERLOCK `GuardManager` and `ProtectionVault`
events. It does not index Coston2 generally and is never a prerequisite for contract reads
or the web application's readiness.

It starts at `AVERLOCK_START_BLOCK`, calls `eth_getLogs` with configured address and event
topic filters, and persists a minimal SQLite database: indexed events plus one cursor. Event
writes are idempotent on `(transaction_hash, log_index)`. The cursor is advanced only after a
complete range is committed.

Coston2 limits filtered `eth_getLogs` requests to 30 blocks. The indexer clamps
`AVERLOCK_LOG_BLOCK_RANGE` to 30, so the service remains compatible even if an older Railway
variable is still set to `250`.

`AVERLOCK_CONFIRMATIONS` defaults to 12. Every run rewinds the persisted cursor by
`AVERLOCK_REORG_OVERLAP` (default 24) before resuming, deletes only that overlap's derived
events, and replays it. This makes short Coston2 reorgs safe without claiming the service is
at the chain head.

Endpoints:

- `GET /health` — process and database health; never reports fully ready merely because it is alive.
- `GET /sync` — honest indexed block, safe chain head, and lag.
- `GET /activity?owner=0x...` — public AVERLOCK history for one owner.
- `GET /guards?owner=0x...` — receipt anchors for the Guards page.

Run locally with `npm run start --workspace @averlock/event-indexer` after setting the variables
in `.env.example`. Run `npm run test:coston2-rpc --workspace @averlock/event-indexer` to make a
live one-block Coston2 compatibility request.
