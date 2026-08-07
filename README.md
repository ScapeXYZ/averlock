# AVERLOCK

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
