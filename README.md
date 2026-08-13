# AVERLOCK Base

The active product on branch `base/mainnet` targets **Base Sepolia only**. It uses public,
transparent protection guards backed by USDC and an immutable linear-release vault. ETH is the
network gas token.

- Chain ID: `84532`
- RPC: `https://sepolia.base.org`
- BaseGuardManager: `0xB2d5B8a9dF91466F07fcBA92f334cb143197151d`
- BaseProtectionVault: `0x5f7a95160A34e84B91e25903b69B8B378094a9B0`
- Approved Base Sepolia USDC: `0x036CbD53842c5426634e7929541eC2318f3dCF7e`
- Indexer start block: `45438094`

Contract reads are authoritative for current state. The optional AVERLOCK event indexer handles
only owner discovery and activity/history. It never substitutes indexed or fabricated data for
contract state.

Historical Flare sources remain under `packages/contracts/src`, `packages/fcc-extension`,
`packages/fdc-scripts`, and `apps/web/src/lib/averlock`. They are not part of the Base web
route tree or public runtime.

## Local validation

```bash
npm ci
npm run typecheck
npm run lint
npm run test --workspace @averlock/web
npm run test --workspace @averlock/event-indexer
npm run build
npm run check:base-sepolia
```

Copy `apps/web/.env.example` to `apps/web/.env.local` for local web overrides. Copy
`packages/event-indexer/.env.example` to `packages/event-indexer/.env` when running the
indexer locally. These files contain public deployment identifiers only; never add wallet keys,
seed phrases, keystore passwords, or private RPC credentials.

See [docs/base-sepolia.md](docs/base-sepolia.md) for the lifecycle and deployment runbook.
