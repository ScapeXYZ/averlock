# AVERLOCK hackathon-critical test checklist

Run these on Coston2 before recording the demo. Do not mark a confidential result verified unless
the real FCC result endpoint and onchain signature checks complete.

- [ ] Connect a wallet on Coston2 (chain ID 114).
- [ ] Load Dashboard with the broad C-chain indexer and FCC proxy unavailable; current contract state still loads.
- [ ] Open an existing guard and confirm owner/configuration from `GuardManager.getGuard`.
- [ ] Create a confidential guard while FCC is available; confirm `GuardRegistered` on Coston2.
- [ ] Confirm the new guard appears from the AVERLOCK event indexer after its confirmation buffer.
- [ ] Confirm vault fields come directly from `ProtectionVault` (`getPosition`, claimable, locked, vesting).
- [ ] Check `/health` and `/sync`; verify lag is reported and not represented as chain-head sync.
- [ ] Restart the event-indexer with its `/data` volume; confirm its cursor resumes and duplicate rows are absent.
- [ ] Submit a known event, then verify only the six AVERLOCK event topics were indexed.
- [ ] Disable FCC endpoint access; Dashboard, Guards, and Vaults remain usable.
- [ ] With FCC disabled, start confidential evaluation; UI reports pending/unavailable and sends no execution transaction.
- [ ] With FCC available, verify a genuine signed result and run `executeGuard`; validate consumed event/result/nonce state.
- [ ] Confirm activity never shows private policy fields or a synthetic verified decision.
- [ ] Open every Coston2 explorer transaction/address link.
- [ ] Run `npm run lint`, `npm run typecheck`, `npm run build`, and `npm test --workspace @averlock/web`.
- [ ] Run `forge test` from `packages/contracts` before any contract deployment (no contract redeploy is required by this refactor).
