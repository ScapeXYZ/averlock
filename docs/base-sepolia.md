# AVERLOCK on Base Sepolia

The Base implementation is isolated under `packages/contracts/src/base`, `packages/contracts/test/base`, and `packages/contracts/script/base`. Historical Flare/Coston2 contracts and tooling remain beside it.

## Base v1 flow

1. `createGuard` registers an immutable approved asset, bounded amount, cooldown, and release duration.
2. The owner approves the exact amount and calls `fundGuard`. Funding cannot be undone or deactivated.
3. After `eligibleAt`, any account may call `executeGuard`.
4. Execution transfers the committed amount into `BaseProtectionVault` for the owner.
5. The beneficiary claims linearly vested funds.
6. After the full position is claimed, anyone may call `completeGuard`.

Only a `Registered` and unfunded guard may be deactivated. There is no admin, rescue withdrawal, proxy, or upgrade mechanism.

## Event schema

- `GuardCreated`: owner discovery and immutable terms
- `GuardFunded`: arming transaction, amount, and eligibility time
- `GuardStateChanged`: persisted lifecycle transitions
- `GuardExecuted`: guard-to-position binding
- `GuardCompleted`: final guard state
- `GuardDeactivated`: safe pre-funding deactivation
- `PositionCreated`: vault deposit and schedule
- `Claimed`: beneficiary releases

Contract reads are authoritative. The event indexer is discovery/history only.

## Deployment gate

Use `packages/contracts/.env.base.example` and `apps/web/.env.example`. Zero addresses mean “not configured” and intentionally disable writes.

Required before deployment: a Base Sepolia RPC, an approved ERC-20 address with deployed code, a funded Base Sepolia account in a Foundry encrypted keystore, and Foundry installed locally.

```sh
cd packages/contracts
forge fmt --check
forge build
forge test
forge script script/base/DeployBaseSepolia.s.sol:DeployBaseSepolia --rpc-url "$BASE_SEPOLIA_RPC_URL" --account <keystore-account>
```

Broadcast is deliberately blocked until those prerequisites exist and every Solidity check passes.
