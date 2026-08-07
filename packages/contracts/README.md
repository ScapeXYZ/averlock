# AVERLOCK Contracts

## ProtectionVault

`ProtectionVault` is AVERLOCK's first on-chain component. It holds standard ERC-20 assets in independent positions and releases each position linearly to its fixed beneficiary between a start and end timestamp.

A position is deliberately non-cancelable after creation. There is no owner or administrator, no early-withdrawal or rescue function for protected principal, and no way to change or transfer a position's asset, beneficiary, amount, or schedule. The beneficiary may claim only the amount vested at the current timestamp minus prior claims.

For example, a 1,000-token position running for 30 days has zero vested at its start, approximately 500 tokens vested after 15 days, and all 1,000 tokens vested at its end.

Deposits use OpenZeppelin `SafeERC20` and must increase the vault's balance by exactly the requested amount. Fee-on-transfer, rebasing, and other unusual token mechanics are not supported. The token contracts under `test/mocks/` are test-only and are never production assets.

The planned production target asset is FXRP on Flare. During Phase 2, FXRP, FDC, FTSOv2, and Flare Confidential Compute were intentionally not implemented or simulated.

## Phase 3: XRP/USD FTSOv2 reader

AVERLOCK will eventually need the XRP/USD price to value a verified XRP payment before evaluating a protection threshold. `XrpUsdPriceReader` is a focused Coston2 reader for Flare's decentralized FTSOv2 block-latency feed; it is not connected to `ProtectionVault` and does not trigger any action.

The official Flare feed catalog identifies XRP/USD as a category `1` Crypto feed with ID:

```text
0x015852502f55534400000000000000000000000000
```

This ID was also verified on Coston2 through the registry-resolved `FtsoFeedIdConverter`: converting category `1` and `XRP/USD` produced the ID above, and reverse conversion returned category `1` and `XRP/USD`.

The reader resolves FTSOv2 through the official Coston2 `ContractRegistry` and returns the feed's raw value, signed decimal count, and update timestamp. It never assumes a fixed feed precision. `normalizePriceUsd18` converts a returned tuple to 18-decimal USD, while `xrpDropsToUsd18` expects an XRP amount in **drops** (`1 XRP = 1,000,000 drops`) and rounds integer results down.

### Live Coston2 observation

A real, read-only `eth_call` on 2026-08-03 returned:

```text
Raw XRP/USD value: 1,073,578
Decimals:           6
Normalized price:  $1.073578 per XRP
Feed timestamp:     1,785,796,764 (2026-08-03 22:39:24Z)
Post-read block:    33,595,543
Post-read block time: 2026-08-03 22:40:04Z
```

FTSOv2's `getFeedByIdInWei` independently returned `1,073,578,000,000,000,000` with timestamp `1,785,796,778` (2026-08-03 22:39:38Z), matching the local decimal normalization. This is a time-specific live result, not a mocked test value or a guaranteed current price.

The Flare dependency was updated for Phase 6 to official `flare-periphery 0.1.52` (upstream commit `ca264d6a31ddfb53d1bef7cb7bd1942aa89d323a`) because that release provides the current Coston2 `IXRPPayment` interfaces.

FDC, FCC, FXRP, and price-triggered vault actions remain intentionally unimplemented. No contract was deployed for this verification.

## Phase 4: XRPL payment proof

A real 10 XRP payment was validated on XRPL Testnet and proved through Flare FDC on Coston2. Request transaction `0x3beee7d32736bf271aee129ead75b86589c12aaebfa4233fc587ece14778d047` entered finalized FDC voting round `1415214`. The official DA Layer returned the real `XRPPayment` response and Merkle proof, and registry-resolved `FdcVerification.verifyXRPPayment` returned `true` by read-only call.

See [`../../docs/fdc-xrpl-demo.md`](../../docs/fdc-xrpl-demo.md) for public transaction details, decoded proof fields, and verification results. No AVERLOCK verifier was deployed in Phase 4. A future consumer will wrap the official `IXRPPayment.Proof` structure and add transaction-ID replay protection before downstream action. FDC proof of payment does not transfer or control XRP, and remains separate from FTSOv2, FCC, FXRP, and vault execution.

## Phase 6: GuardManager (local)

`GuardManager` locally composes the official XRPPayment proof adapter, the existing XRP/USD reader, a signed FCC decision, FXRP funding, and `ProtectionVault`. Guards store only public routing metadata and a policy commitment. Payment amount and USD valuation come from verified proof data and a fresh FTSO price, never frontend inputs.

Triggered funding is approval-based: the guard owner approves `GuardManager`, which transfers the calculated FXRP amount and immediately creates a 30-day non-cancelable vault position for that owner. Exact balance checks reject unusual transfer mechanics and ensure the manager retains no incidental custody. USD-to-FXRP conversion uses token decimals and rounds down.

The FCC verifier authenticates the scaffold's `TEE_ACTION_RESULT` signature and decodes the canonical decision through `FCCDecisionCodec`. Phase 6.1 migrated the Go extension to the same fixed 352-byte ABI payload, added cross-language golden vectors, and passed the real Coston2 retest against PRODUCTION TEE `0x9F2e818133F95249F991334bA26b92df2c932b4E`.

Phase 6.2 resolves Coston2 dependencies through ContractRegistry, validates the expected addresses and deployed code, and derives FTestXRP from `AssetManagerFXRP.fAsset()`. The current token is `FTestXRP` at `0x0b6A3645c240605887a5532109323A3E12273dc7` with 6 decimals. `FCCDecisionCodec` is an internal library and has no independent deployment.

The Phase 6.2 encrypted-keystore deployment is complete on Coston2:

- `ProtectionVault`: `0xCcF6D8A6AA0F3799f6c9c6069289D4013aABF4Eb`, transaction `0x09c3db3f4a23a4a7781896f16def427320aad15b03b63bed09809e1075856822`
- `XrpUsdPriceReader`: `0xf2F2bf463b0765729189DeBe4E22dCEd601A18d5`, transaction `0x6d0b77e6066587a1f3879622b0516f5e31a78e049a1911e64e26210e4c5283a0`
- `XrplPaymentVerifier`: `0x10B2419e526Dc860E85c2315536389FA0D1269DA`, transaction `0x6f8c4243abe4ab0c9f7544bdf4ef583e8aaa574912956e0b977f9ba0c4bfa93f`
- `GuardManager`: `0xAcCFe71D9748F632f74726F48CFAbD963420ffD7`, transaction `0x2699a33a49ca8ab063eb8d7fbcd08f80ab68d61635f4519f8c2c73fe6c2d6baa`

Read-only verification confirmed all bytecode and constructor wiring. No guard has been registered or executed, no FTestXRP approval or transfer occurred, and `ProtectionVault.positionCount()` remains zero.

Phase 6.3A found that the deployed GuardManager's V1 timing and live-price semantics are unsuitable for the funded end-to-end flow. The local V2 replacement adds a one-time `prepareGuardEvaluation` step that verifies FDC and stores the exact fresh FTSO snapshot before FCC evaluation. Final execution verifies the V2 signed value against that snapshot instead of re-reading a moving price. The deployed V1 GuardManager remains untouched; replacement deployment is intentionally deferred.

See [`../../docs/end-to-end-guard-flow.md`](../../docs/end-to-end-guard-flow.md) for bindings, replay protection, live Coston2 address preparation, and the privacy boundary.

## Local checks

Run from Ubuntu-22.04 WSL:

```bash
cd /mnt/c/Users/USER/Documents/averlock/packages/contracts
forge install OpenZeppelin/openzeppelin-contracts@v5.6.1 --no-git --shallow
forge install foundry-rs/forge-std --no-git --shallow
forge soldeer install
forge fmt --check
forge build
forge test -vvv
forge test --gas-report
```
