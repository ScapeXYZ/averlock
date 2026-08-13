# Clean ProtectionVault guard test

This is the only acceptable funded test after the GuardManager replacement.
Do not use a rule, payment, FDC proof, event hash, action result, or position
from the retired manager.

## Fixed test parameters

| Field | Value |
| --- | --- |
| Network | Coston2 (chain ID `114`) / XRPL Testnet |
| FCC extension | `65927` (`0x10187`) |
| FCC proxy | `https://chic-essence-production.up.railway.app` |
| TEE | `0xbAd2a9e9c836efEB970B6B42A04208ee9B8d4E71` |
| XRPL amount | `1000 XRP` = `1000000000` drops |
| XRPL memo UTF-8 | `AVERLOCK_E2E_V2_002` |
| XRPL memo hex | `415645524C4F434B5F4532455F56325F303032` |
| XRPL destination tag | `63002` |
| threshold | `1000000000000000000000` USD-18 ($1,000) |
| protect BPS | `7000` |
| maximum per event | `10000000000000000000000` USD-18 ($10,000) |
| schedule | `1` (30-day linear) |
| cooldown | `60` seconds |
| policy expiry | current Unix time + `86400` seconds |
| prepare gas | `500000` |

The rule ID must be a newly generated nonzero bytes32 value. The policy
commitment must be the acknowledgment returned by `CREATE_POLICY`; do not
compute a substitute commitment in the browser.

## Runtime gate (no transactions)

First derive the public key returned by `/info`, then set `EXPECTED_TEE_ID` to
that result. It must be `0xbAd2...4E71` for the current registered production
identity:

```bash
cd packages/fcc-extension
EXPECTED_TEE_ID=0xbAd2a9e9c836efEB970B6B42A04208ee9B8d4E71 \
EXPECTED_SIGNER_ADDRESS=0x8E4f5D2736B988D4e922b988FF89bcCde45C6f2f \
EXPECTED_EXTENSION_ID=65927 \
EXPECTED_PROXY_URL=https://chic-essence-production.up.railway.app \
CHAIN_URL=https://coston2-api.flare.network/ext/C/rpc \
./scripts/fcc-ready-for-instruction.sh
```

On Railway, inspect the extension-tee logs over two signing-policy intervals.
Require successful periodic `TEE_INFO`, no `signing policy not initialized`,
no `invalid teeID`, and completed DirectQueue, MainQueue, and BackupQueue
work. Then submit one disposable non-Guard health instruction through the
existing instruction tool and require its signed ActionResult to be retrievable
from `/action/result/<actionId>` before creating the guard. This is a runtime
operation and intentionally is not automated by this repository.

## Wallet transactions, in order

1. The Coston2 guard-owner wallet calls `registerGuard(newRuleId, returnedPolicyCommitment, keccak256(xrplReceiverAddress), 1)` on the new GuardManager.
2. The XRPL Testnet sender wallet submits the `1000 XRP` payment with the fixed
   memo and destination tag above. Record its validated hash.
3. The Coston2 guard-owner wallet requests the FDC attestation using that hash
   and `proofOwner = <new GuardManager>`; wait for the requested FDC voting
   round to finalize and retrieve the resulting proof.
4. The Coston2 guard-owner wallet calls `prepareGuardEvaluation(newRuleId, proof)` with gas `500000`. Record the emitted `eventHash`, stored FTSO price,
   and preparation block.
5. The FCC sender submits `EVALUATE_GUARD` for that exact stored snapshot and
   records the persisted signed ActionResult. Verify its signature against
   `0xbAd2...4E71`, `evaluatedAt >= preparedAt`, and an expiry no more than 600
   seconds after evaluation.
6. The Coston2 guard-owner wallet approves the exact quoted FTestXRP amount to
   the new GuardManager.
7. The Coston2 relayer or guard-owner wallet calls `executeGuard(newRuleId,
   eventHash, actionResult)` before `resultExpiry`.

The third and fifth steps can involve the existing FDC/FCC submission flow;
they are still wallet transactions where that provider charges Coston2 fees.
No old Phase 6.3 transaction, action ID, or proof is valid for this sequence.

## Final UI evidence

The new guard detail page must show the replacement GuardManager, the fresh
rule ID and event hash, `FDC` verified, the stored price snapshot, FCC result
signature verified under `0xbAd2...4E71`, action/event/nonce consumed, and a
new ProtectionVault position. The position must show FTestXRP deposited,
beneficiary equal to the guard owner, schedule `1`, a 30-day release window,
and no cancellation control. Populate the `NEXT_PUBLIC_AVERLOCK_*` receipt
selectors only from these new receipts.
