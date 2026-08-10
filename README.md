# AVERLOCK

## Flare Summer Signal — Bounty 2: Confidential Compute Apps

**AVERLOCK** is a programmable on-chain protection protocol deployed on **Flare Coston2**.
It lets a user register a guard for an XRPL payment identity, prepare a verified FDC/FTSO
event snapshot, obtain a private FCC decision when required, and lock the resulting FTestXRP
into a non-cancelable `ProtectionVault` release position. The target user is an individual or
treasury that wants a verifiable emergency/protection rule without publishing the rule's
threshold, cap, cooldown, or expiry.

Demo: _add public demo URL_ · GitHub: _this repository_

### Architecture refactor built during this hackathon

Before this refactor, the operational path was coupled to broad C-chain/FCC infrastructure and
browser-held receipt anchors. A slow general indexer or unavailable tee-proxy could make useful
application views appear unavailable.

Now current protocol state is read directly from the deployed Coston2 contracts:

```text
Wallet → AVERLOCK web app → GuardManager / ProtectionVault on Coston2
                                  ↑
                         authoritative current state

AVERLOCK contract events → AVERLOCK-only event indexer → Activity / guard history
Private rule evaluation → Flare Confidential Compute → signed result → GuardManager execution
```

The new `packages/event-indexer` service starts at the AVERLOCK deployment block and indexes
only `GuardRegistered`, `GuardEvaluationPrepared`, `GuardEvaluated`, `GuardTriggered`,
`PositionCreated`, and `Claimed`. It uses filtered `eth_getLogs`, SQLite cursor persistence,
idempotent writes, bounded retries, a 12-block confirmation buffer, and a 24-block replay
overlap for short reorgs. It never indexes general Coston2 activity and is **not** an app
readiness dependency; `/sync` reports lag honestly.

FCC remains real, not mocked. A policy is encrypted for the registered FCC TEE; later, the TEE's
genuine signed decision is independently verified and passed to `GuardManager.executeGuard`.
The web app represents FCC states as pending, verified, failed, or unavailable. If FCC is down,
no confidential execution occurs and no result is fabricated; direct guard, vault, and current
contract-state reads continue to work.

### Coston2 deployments and Flare usage

- GuardManager: `0x444947Aaa00aB3fddbeb6421244A160448E6B52D`
- ProtectionVault: `0xCcF6D8A6AA0F3799f6c9c6069289D4013aABF4Eb`
- XrpUsdPriceReader: `0xf2F2bf463b0765729189DeBe4E22dCEd601A18d5`
- XrplPaymentVerifier: `0x10B2419e526Dc860E85c2315536389FA0D1269DA`
- FCC InstructionSender: `0x530D307Cca3A01BfC9139934b3F5Fa1DA19E728D`

Flare integration: Coston2 contracts, FDC XRPL payment proofs, FTSOv2 XRP/USD snapshots, and
Flare Confidential Compute for private protection-condition evaluation.

### Current limitations and roadmap

The deployed guard contract currently represents a confidential-policy guard: its commitment is
created through FCC before it can later be evaluated. This is deliberate security binding, so a
non-confidential guard type would require an explicit small contract version rather than a fake
or unbound commitment. Next: deploy that opt-in deterministic guard variant, move the indexer to
a durable Railway volume, and add paginated history and production FCC operations monitoring.

The legacy general C-chain indexer, tee-proxy, MySQL, Redis, and existing Railway definitions are
retained for rollback/FCC operations, but are no longer core app dependencies.

### Railway deployment (manual)

Create one new service only if Activity/history needs hosted indexing. Use repository root as the
service root, Dockerfile `packages/event-indexer/Dockerfile` (configuration in
`railway-event-indexer.toml`), start command `npm start`, healthcheck `/health`, and watch paths
`packages/event-indexer/**`, `package.json`, and `package-lock.json`. Attach a small persistent
volume mounted at `/data`; do **not** point it at, reset, or reuse the FCC MySQL volume.

Set `AVERLOCK_RPC_URL`, `AVERLOCK_CONTRACT_ADDRESSES`, `AVERLOCK_START_BLOCK`,
`AVERLOCK_INDEXER_DB_PATH=/data/averlock-events.sqlite`, `AVERLOCK_CONFIRMATIONS=12`,
`AVERLOCK_REORG_OVERLAP=24`, `AVERLOCK_LOG_BLOCK_RANGE=250`, and `PORT=8080`. Set the resulting
public URL as `NEXT_PUBLIC_AVERLOCK_INDEXER_URL` on the web service, then redeploy the web app.

Service classification: web + Coston2 RPC are **required for the demo**; the AVERLOCK event
indexer is **optional history**; tee-proxy/FCC plus its C-chain indexer, Redis, and MySQL are
**optional for confidential verification**; the broad standalone C-chain indexer is **legacy / no
longer a core-app dependency**.

AVERLOCK is a private, cross-chain, programmable self-custody application for the Flare Summer Signal hackathon. It is designed to let users define financial protection rules that can react to verified cross-chain activity while preserving user control and rule privacy.

## Current phase

**Phase 1 — environment and development skeleton**

This repository currently provides the monorepo structure and a minimal frontend development screen. Protocol integrations, asset-protection flows, vault logic, and production smart contracts are intentionally not implemented yet.

## Planned Flare stack

- **Flare EVM** — application coordination and programmable execution
- **FDC** — verified attestations for activity originating on external chains
- **FTSOv2** — decentralized XRP/USD valuation
- **Flare Confidential Compute (FCC)** — private protection-rule evaluation
- **FXRP** — programmable representation of protected XRP on Flare

These components describe the planned architecture and are not claims about the current Phase 1 implementation.

## Workspace

- `apps/web/` — Next.js and TypeScript application shell
- `packages/contracts/` — reserved Foundry workspace; no application contracts yet
- `packages/fcc-extension/` — reserved confidential-compute extension workspace
- `packages/fdc-scripts/` — reserved FDC scripts workspace
- `packages/shared/` — reserved shared code workspace
- `docs/` — project documentation
- `scripts/` — project-level development scripts

## Local development

```bash
npm install
npm run dev
```

For local frontend configuration, copy `apps/web/.env.example` to `apps/web/.env.local` and replace placeholders with non-secret environment-specific values. Never store private keys, seed phrases, wallet secrets, or API keys in tracked files.

Validation:

```bash
npm run typecheck
npm run lint
npm run build
```

Foundry will be required for future contract work. It is not currently installed in the verified local environment.
