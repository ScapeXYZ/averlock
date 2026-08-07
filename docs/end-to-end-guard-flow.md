# AVERLOCK Phase 6 end-to-end guard flow

Phase 6 locally implements and tests:

```text
XRPL payment → FDC XRPPayment proof → FTSOv2 XRP/USD valuation
             → FCC signed private-rule decision → GuardManager
             → approved FXRP → non-cancelable ProtectionVault position
```

## Privacy and binding

A guard stores only owner, `ruleId`, policy commitment, monitored receiver hash, schedule ID, active state, and creation time. It never stores threshold, maximum-per-event, cooldown, or policy expiry. Execution-required FCC outputs may become public after evaluation.

`XrplPaymentVerifier` consumes the official `IXRPPayment.Proof`, requires `testXRP`, calls `IXRPPaymentVerification`, and extracts only the verified transaction ID, receiver hash, positive drops, and ledger timestamp. Payment status must be success (`0`).

The canonical event hash is:

```solidity
keccak256(abi.encode(
    keccak256("AVERLOCK_XRPL_EVENT_V1"),
    transactionId,
    receivingAddressHash,
    receivedDrops,
    blockTimestamp
))
```

The existing reader provides `priceUsd18` plus timestamp. GuardManager rejects zero, future, or stale prices; an initial deployment tolerance of 300 seconds is planned. It computes `eventValueUsd18 = floor(receivedDrops × priceUsd18 / 1_000_000)`.

The local FCC path verifies the scaffold `TEE_ACTION_RESULT` envelope against chain ID 114 and the configured TEE. Its decision binds rule ID, event hash, calculated value, payment timestamp, nonce, expiry, schedule, and an `AVERLOCK_GUARD_RESULT_V1` hash.

Phase 6.1 migrated `EVALUATE_GUARD` from JSON to a fixed 352-byte ABI payload. Local Go/Solidity golden vectors agree, and the migrated live Coston2 FCC test passed against the current PRODUCTION TEE. Caller-supplied decoded fields remain forbidden.

Exact order: `bytes32 domain`, `bytes32 ruleId`, `bytes32 eventHash`, `bool triggered`, `uint256 protectedUsd18`, `uint16 protectBps`, `uint32 scheduleId`, `uint256 eventValueUsd18`, `uint64 evaluatedAt`, `uint256 nonce`, `uint64 resultExpiry`. Domain is `keccak256("AVERLOCK_GUARD_RESULT_V1")`. The V1 result hash remains `keccak256(abi.encode(domain, chainId, ruleId, eventHash, triggered, protectedUsd18, protectBps, scheduleId, eventValueUsd18, evaluatedAt, nonce, resultExpiry))`.

Non-trigger decisions have the same shape with execution-only protected amount, basis points, and schedule zeroed. The decoder requires exactly 352 bytes and canonical re-encoding.

## Funding, schedule, and replay

FDC proves movement but cannot pull native XRP from XRPL. The MVP owner pre-positions FXRP on Flare and approves GuardManager. Protected FXRP is `floor(protectedUsd18 × 10^fxrpDecimals / priceUsd18)`. The manager receives exactly that amount, grants the vault an exact allowance, creates the position, clears allowance, and verifies it retained no tokens. Schedule `1` means a 30-day linear release beginning at execution.

Consumed XRPL event hashes, FCC action IDs, and rule-scoped nonces are independent replay barriers. Non-trigger decisions consume the event as well.

## Coston2 preparation (read-only, 2026-08-04)

Resolved through official ContractRegistry `0xaD67FE66660Fb8dFE9d6b1b4240d8650e30F6019`:

- FdcVerification: `0x906507E0B64bcD494Db73bd0459d1C667e14B933`
- FtsoV2: `0xC4e9c78EA53db782E28f28Fdf80BaF59336B304d`
- AssetManagerFXRP: `0xc1Ca88b937d0b528842F95d5731ffB586f4fbDFA`
- FXRP from `fAsset()`: `0x0b6A3645c240605887a5532109323A3E12273dc7`

Existing FCC inputs are InstructionSender `0x530D307Cca3A01BfC9139934b3F5Fa1DA19E728D`, current PRODUCTION TEE `0x9F2e818133F95249F991334bA26b92df2c932b4E`, manager `0x1a9C4A0f9D76c0b1D91d22E24E573a9b377618aE`, and extension ID `0x0000000000000000000000000000000000000000000000000000000000010187`.

The Phase 6.2 preflight reconfirmed these addresses, verified deployed code, derived FTestXRP from `AssetManagerFXRP.fAsset()`, and read token symbol `FTestXRP` with 6 decimals. Final Coston2 deployment evidence:

| Contract | Address | Transaction | Block | Gas |
| --- | --- | --- | ---: | ---: |
| ProtectionVault | `0xCcF6D8A6AA0F3799f6c9c6069289D4013aABF4Eb` | `0x09c3db3f4a23a4a7781896f16def427320aad15b03b63bed09809e1075856822` | 33,619,275 | 852,201 |
| XrpUsdPriceReader | `0xf2F2bf463b0765729189DeBe4E22dCEd601A18d5` | `0x6d0b77e6066587a1f3879622b0516f5e31a78e049a1911e64e26210e4c5283a0` | 33,619,276 | 468,466 |
| XrplPaymentVerifier | `0x10B2419e526Dc860E85c2315536389FA0D1269DA` | `0x6f8c4243abe4ab0c9f7544bdf4ef583e8aaa574912956e0b977f9ba0c4bfa93f` | 33,619,277 | 522,620 |
| GuardManager | `0xAcCFe71D9748F632f74726F48CFAbD963420ffD7` | `0x2699a33a49ca8ab063eb8d7fbcd08f80ab68d61635f4519f8c2c73fe6c2d6baa` | 33,619,741 | 2,093,235 |

Read-only verification confirmed GuardManager is wired to the three contracts above, FTestXRP `0x0b6A3645c240605887a5532109323A3E12273dc7`, current TEE `0x9F2e818133F95249F991334bA26b92df2c932b4E`, and a 300-second maximum price age. Its payment verifier uses FdcVerification `0x906507E0B64bcD494Db73bd0459d1C667e14B933` and source `testXRP`. No guard execution or token movement occurred during Phase 6.2.

## Phase 6.3A timing and valuation correction (local only)

The deployed Phase 6.2 GuardManager and live FCC image use V1 semantics and must not be used for a funded guard. V1 made `evaluatedAt` equal the XRPL ledger timestamp and set `resultExpiry = paymentTimestamp + 600`. The Phase 4 payment timestamp was `1785797411`; its FDC request was not mined until `1785799273`, already 1,862 seconds later. The authorization was therefore expired before FDC submission, even before the 90–180 second round finalization and proof-retrieval steps.

V1 also queried a current block-latency FTSO price inside `executeGuard` after FCC had signed an exact `eventValueUsd18`. Since the feed can update each block, the FCC input and contract recomputation could legitimately differ.

The local V2 design separates the timeline:

1. `paymentTimestamp` remains permanently bound inside `AVERLOCK_XRPL_EVENT_V1`.
2. The guard owner calls `prepareGuardEvaluation` with the finalized FDC proof. GuardManager verifies the proof, reads one fresh FTSO value/timestamp, computes the event value, and stores that immutable snapshot by event hash.
3. FCC evaluates the stored public value. `evaluatedAt` is the trusted FCC instruction timestamp, not client input, and `resultExpiry = evaluatedAt + 600`.
4. `executeGuard` verifies the signed value against the stored snapshot and uses the same stored price for USD-to-FTestXRP conversion. Later feed movement cannot change or invalidate the decision.

The decision remains 352 bytes with the same field order, but the domain is explicitly versioned to `keccak256("AVERLOCK_GUARD_RESULT_V2")` because the meaning of `evaluatedAt` changed. GuardManager enforces evaluation after snapshot preparation, no future evaluation time, expiry after evaluation, a maximum 600-second result lifetime, and current non-expiry. Event, result, and nonce replay barriers remain unchanged.

This correction is not live. It requires a replacement GuardManager and a rebuilt/re-registered V2 FCC TEE before any Phase 6.3 funded execution. ProtectionVault, XrpUsdPriceReader, and XrplPaymentVerifier can be reused.
