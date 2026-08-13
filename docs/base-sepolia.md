# AVERLOCK Base Sepolia runbook

## Live deployment

| Item | Value |
| --- | --- |
| Network | Base Sepolia |
| Chain ID | `84532` |
| Gas token | ETH |
| Protection asset | Base Sepolia USDC (6 decimals) |
| RPC | `https://sepolia.base.org` |
| BaseGuardManager | `0xB2d5B8a9dF91466F07fcBA92f334cb143197151d` |
| BaseProtectionVault | `0x5f7a95160A34e84B91e25903b69B8B378094a9B0` |
| USDC | `0x036CbD53842c5426634e7929541eC2318f3dCF7e` |
| Deployment/indexer block | `45438094` |

No contract deployment is part of the web or indexer release process.

## Contract lifecycle

1. `createGuard` registers a Cooldown or StablecoinProtection guard with an approved asset,
   amount, cooldown, and release duration.
2. Only the owner can deactivate a guard, and only while it is Registered and unfunded.
3. The owner approves USDC and calls `fundGuard`. Funding is irreversible and sets
   `eligibleAt = fundedAt + cooldown`.
4. Once eligible, any account may call `executeGuard`. Execution creates a vault position for
   the guard owner.
5. The beneficiary claims the linearly vested amount from BaseProtectionVault.
6. Once the entire position has been claimed, anyone may call `completeGuard` to persist the
   Completed state.

The web simulates supported writes before requesting a wallet signature. It reads token decimals,
allowances, guard state, vault positions, claimable amounts, and completion state directly from
the contracts.

## Web deployment

Vercel is the simplest frontend path. Import the repository, keep the project root at the
repository root, and use the checked-in `vercel.json`. Add the five web variables listed in
`apps/web/.env.example`. Set `NEXT_PUBLIC_AVERLOCK_INDEXER_URL` after the indexer has a public
HTTPS URL; leaving it empty keeps current-state pages usable and marks discovery/history as
degraded.

The root `Dockerfile` is an alternative standalone Next.js image and contains only traced
runtime dependencies in its final stage.

## Indexer deployment

Railway is recommended because the SQLite cursor needs a persistent volume:

1. Create a service from this repository using `railway-event-indexer.toml` or
   `packages/event-indexer/Dockerfile`.
2. Mount a persistent volume at `/data`.
3. Add every variable from `packages/event-indexer/.env.example`.
4. Verify `GET /health` and `GET /sync`, then set its HTTPS URL as the web indexer URL.

The indexer accepts exactly two distinct non-zero contract addresses. It starts at block
`45438094` and requests only the eight configured AVERLOCK event topics from BaseGuardManager
and BaseProtectionVault. SQLite uniqueness is `transaction_hash + log_index`; confirmations,
reorg replay overlap, bounded block ranges, pacing, and honest degraded states are retained.

## Read-only release gate

```bash
npm run check:base-sepolia
```

This verifies chain ID, bytecode, GuardManager-to-vault binding, approved USDC, token symbol and
decimals, contract version, and a deployment-block filtered log query. It has no signer and
cannot send a transaction.
