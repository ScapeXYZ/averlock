# Phase 4 XRPL Testnet → Flare FDC verification

Phase 4 selected the XRPL-specific `XRPPayment` attestation because it directly exposes the sender r-address, first memo data, destination tag, received XRP drops, and payment status. The source identifier is `testXRP` and the attestation type ID is `0x08`.

## Validated XRPL Testnet payment

- Sender: `rSAJ3aWFJoFoqk19kKiYZ2mtsnLAJLjKG`
- Monitored receiver: `rnia71KXZRwXu64jdNnU53oCZ2L7TrkcyH`
- Transaction: `649EA21AAD17F54805993547E9EC9031851FC652AE8ADD3F8497F60D7D711D2D`
- Ledger index: `19611360`
- Sent and delivered: `10,000,000` drops (`10 XRP`)
- Result: `tesSUCCESS`, validated
- First memo: `AVERLOCK_DEMO_001`
- MemoData: `415645524C4F434B5F44454D4F5F303031`
- Destination tag: `42001`

The disposable sender and receiver seeds are stored only in `packages/fdc-scripts/.env.local`, which is ignored by Git. They are XRPL Testnet credentials and must never be used on mainnet.

## Prepared FDC request

- Attestation: `XRPPayment`
- Source: `testXRP`
- `proofOwner`: `0x0000000000000000000000000000000000000000`
- Verifier status: `VALID`
- Coston2 `FdcHub`: `0x48aC463d7975828989331F4De43341627b9c5f1D`
- Coston2 fee configuration: `0x191a1282Ac700edE65c5B0AaF313BAcC3eA7fC7e`
- Fee observed before safe stop: `1,000 wei`

ABI-encoded request:

```text
0x5852505061796d656e7400000000000000000000000000000000000000000000746573745852500000000000000000000000000000000000000000000000000065165437a1ce7e1c8fe174eeea4ea754e2abaa4097c2c08b9f899e5c85823eb6649ea21aad17f54805993547e9ec9031851fc652ae8add3f8497f60d7d711d2d0000000000000000000000000000000000000000000000000000000000000000
```

Unsigned `requestAttestation(bytes)` calldata:

```text
0x6238f354000000000000000000000000000000000000000000000000000000000000002000000000000000000000000000000000000000000000000000000000000000a05852505061796d656e7400000000000000000000000000000000000000000000746573745852500000000000000000000000000000000000000000000000000065165437a1ce7e1c8fe174eeea4ea754e2abaa4097c2c08b9f899e5c85823eb6649ea21aad17f54805993547e9ec9031851fc652ae8add3f8497f60d7d711d2d0000000000000000000000000000000000000000000000000000000000000000
```

## Coston2 request and voting round

The request was signed manually through Remix and MetaMask. No private key was exported or provided to project tooling.

- Request transaction: `0x3beee7d32736bf271aee129ead75b86589c12aaebfa4233fc587ece14778d047`
- Status: success
- Block: `33596528`
- Destination: `FdcHub` at `0x48aC463d7975828989331F4De43341627b9c5f1D`
- Value: `1,000 wei`
- Exact matching submissions from the signing address: `1`
- Coston2 block timestamp: `1785799273`
- `firstVotingRoundStartTs`: `1658430000`
- Voting epoch duration: `90 seconds`
- FDC voting round: `1415214`
- FDC protocol ID: `200`
- Relay finalization: `true`

The transaction's decoded `requestAttestation(bytes)` argument exactly matches the ABI-encoded request above.

## Real DA Layer proof

The finalized proof was retrieved from the official Coston2 DA Layer using voting round `1415214` and the exact request bytes.

```text
0xf50d657e4250d2571772aa6036addeeda7bce45c25c031a9be504397f7e08318
0x027ee14fda924fc535bd7659b33bd2b28ff1a220f948a68dea3537b229ca47f1
0x8f44b3008448b2380610a1a4a0973e995b86383a313b741e82beda190f4053a0
```

Decoded `IXRPPayment.Response`:

- Attestation: `XRPPayment`
- Source: `testXRP`
- Voting round: `1415214`
- Transaction ID: `649EA21AAD17F54805993547E9EC9031851FC652AE8ADD3F8497F60D7D711D2D`
- Proof owner: zero address
- XRPL ledger index: `19611360`
- XRPL ledger timestamp: `1785797411` (`2026-08-03T22:50:11Z`)
- Source address: `rSAJ3aWFJoFoqk19kKiYZ2mtsnLAJLjKG`
- Source address hash: `0xde5bab9c7fae0ef2d94bd5f9dd351a17162ce6d57b3d59833bce4db2f5d5403e`
- Receiving address hash: `0x09315be6d53add03ed87dd25dae59f3b774f74b14f0a2c6637c4d1287cc5173c`
- Spent amount: `10,000,012 drops` (payment plus the 12-drop XRPL fee)
- Received amount: `10,000,000 drops` (`10 XRP`)
- Intended received amount: `10,000,000 drops`
- First memo: `AVERLOCK_DEMO_001`
- Destination tag: `42001`
- Status: `0` (`SUCCESS` / XRPL `tesSUCCESS`)

## Coston2 verification

- `FdcVerification`: `0x906507E0B64bcD494Db73bd0459d1C667e14B933`
- `Relay`: `0xa10B672D1c62e5457b17af63d4302add6A99d7dE`
- Proof leaf: `0xe32cfff91b6aee03cdf1f6397ff8c4e3b3ddc4d8d3c1656bf8e019ccb25868cc`

Both the underlying Relay Merkle verification and `FdcVerification.verifyXRPPayment` returned `true` through read-only `eth_call`. No AVERLOCK consumer deployment was required for Phase 4.

A future consumer should use the official `IXRPPayment.Proof` type and registry-resolved verifier, then record the transaction ID before executing downstream logic so this payment cannot trigger twice.

## Technical boundary

FDC detects and proves XRP movement; it does not give AVERLOCK control over XRP in either XRPL account. FTSOv2 valuation, FCC private rule evaluation, FXRP execution, and `ProtectionVault` interaction remain separate and unimplemented in this phase. No AVERLOCK contract was deployed and no Phase 5 work was started.
