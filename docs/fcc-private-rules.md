# AVERLOCK confidential rule engine — Phase 5B

Phase 5B implements AVERLOCK's rule decision logic inside the Go extension from Flare's official FCE scaffold. It is a local architecture and behavior validation, not proof of FCC execution on Coston2.

## Operations

The exact Solidity and Go identifiers are:

- OPType: `AVERLOCK_GUARD`
- OPCommand: `CREATE_POLICY`
- OPCommand: `EVALUATE_GUARD`

All fit in bytes32 and are UTF-8 encoded with right-zero padding by the scaffold conventions.

### CREATE_POLICY

The public transport accepts an opaque JSON envelope whose `encryptedPolicy` member is ciphertext. Inside the TEE boundary, the extension calls the scaffold TEE-node `/decrypt` API and strictly decodes this normalized policy:

```text
ruleId: bytes32
thresholdUsd18: uint256 decimal string
protectBps: uint16
scheduleId: uint32
maxPerEventUsd18: uint256 decimal string (zero disables the cap)
cooldownSeconds: uint64
expiresAt: uint64 Unix seconds
```

Validation requires a nonzero rule ID and threshold, `1 <= protectBps <= 10000`, supported schedule `1`, an expiry later than creation time, and a configured maximum no lower than the threshold. Schedule 1 means a 30-day linear release. The response contains only `ruleId`, `accepted`, and `policyCommitment`.

Policy state is currently an in-memory map within the extension. This is sufficient for deterministic Phase 5B tests but is not durable across process restarts. A later FCC design must confirm confidential durable-state behavior before production use.

### EVALUATE_GUARD

The public/trusted input is:

```text
ruleId: bytes32
eventHash: bytes32
eventValueUsd18: uint256 decimal string
eventTimestamp: uint64 Unix seconds
nonce: uint64
```

The extension requires an existing, unexpired policy; rejects duplicate `(ruleId,eventHash)` and `(ruleId,nonce)` pairs; applies the strict `eventValueUsd18 > thresholdUsd18` rule; applies the optional maximum and cooldown; and calculates `floor(eventValueUsd18 * protectBps / 10000)`.

Every result contains `ruleId`, `eventHash`, `triggered`, `evaluatedAt`, `nonce`, and `resultHash`. A triggered result additionally contains `protectedUsd18`, `protectBps`, `scheduleId`, `eventValueUsd18`, and `resultExpiry`. Threshold, cap, cooldown, policy expiry, ciphertext, and other private metadata are never serialized in the public result. Revealing protection basis points and schedule only after a trigger is intentional because the future onchain executor needs those execution terms.

`evaluatedAt` uses the trusted event timestamp, making evaluation and signatures deterministic. Phase 5B uses a 600-second result-validity window.

## Commitment

The policy commitment is:

```text
keccak256(abi.encode(
  keccak256("AVERLOCK_POLICY_V1"),
  ruleId,
  thresholdUsd18,
  protectBps,
  scheduleId,
  maxPerEventUsd18,
  cooldownSeconds,
  expiresAt
))
```

The ABI types are respectively `bytes32, bytes32, uint256, uint16, uint32, uint256, uint64, uint64`. Decimal strings are parsed as canonical uint256 values before encoding, so textual formatting cannot alter the commitment.

## Result domain separation

The result hash is `keccak256(abi.encode(...))` over:

```text
keccak256("AVERLOCK_GUARD_RESULT_V1")
uint256 Coston2 chain ID (114)
ruleId
eventHash
triggered
protectedUsd18
protectBps
scheduleId
eventValueUsd18
evaluatedAt
nonce
resultExpiry
```

This binds the decision to AVERLOCK's versioned domain, Coston2, the specific rule and external event, every public execution field, and its validity window. The extension does not implement a private-key signer. The scaffold returns the payload as an `ActionResult`; the FCC TEE-node framework is responsible for its normal signing/relay path. The embedded result hash makes the application payload explicit and independently reproducible.

## Replay and cooldown

Event hashes and nonces are consumed per rule when evaluated, including non-triggering evaluations. A successful trigger also records its timestamp. Another otherwise eligible event before `lastTriggeredAt + cooldownSeconds` returns a non-triggered decision. A future GuardManager must independently enforce onchain replay protection using the rule ID and event hash.

## Relationship to other AVERLOCK components

In a later phase, verified XRPL payment data will come from FDC and XRP/USD valuation from FTSOv2. A GuardManager will submit the trusted public context, verify the FCC result, enforce replay/expiry, and coordinate an FXRP protection position. Phase 5B does none of those integrations and does not change `ProtectionVault`, FDC, or FTSO behavior.

## Historical local limitations

- Test fixtures supply plaintext policy bytes through a test-only decryptor. They validate policy logic, not encryption or TEE confidentiality.
- Phase 5B alone did not exercise a live Coston2 request or signed ActionResult. Phase 5C evidence below supersedes that historical limitation for the simulated-TEE integration path.
- The Docker check only proves that the customized Go extension compiles into the extension-tee image.
- Local fixtures remain useful for deterministic rule-engine coverage but do not prove hardware-backed confidentiality.
- No wallet secret is stored in tracked files; live lifecycle and proxy signing use an encrypted dedicated testnet keystore.

## Phase 5C simulated-TEE verification

AVERLOCK extension `0x10187` is live on Coston2 through InstructionSender `0x530D307Cca3A01BfC9139934b3F5Fa1DA19E728D`. The current ABI-capable TEE `0x9F2e818133F95249F991334bA26b92df2c932b4E` is registered at the stable URL `https://crescentoid-earless-kelsi.ngrok-free.dev` and has status `2` (`PRODUCTION`) in FlareTeeManager `0x1a9C4A0f9D76c0b1D91d22E24E573a9b377618aE`.

The real encrypted-policy run produced rule ID `0x1d5827daad9855308e3e978b21ef93be877a98e182529f2a994f37aac837e802` and commitment `0xaeee3b2e12d7304fe80789c807781b01fd26b7255aafcc2afa6583467d345ca7`. The commitment matched an independent deterministic recomputation. The triggered result protected `1400000000000000000000` USD18 and had result hash `0xf3b9bd927d045808092573ed9e7c8835268c4314bed0d732c6f102bf171b9c53`; the below-threshold result hash was `0x99b24c79cf31268d20b1c312a0eac5bb1e69d39fc30039f7fc20de380be8b026`. Both hashes independently recomputed exactly.

The same event and nonce returned a signed replay failure rather than a second trigger. A different otherwise-eligible event inside the configured cooldown returned a non-triggered decision. All CREATE, trigger, replay, cooldown, and non-trigger ActionResult signatures verified against the registered TEE using `TEE_ACTION_RESULT`, chain ID 114, and the framework ActionResult hash.

## Phase 6.1 ABI result migration

`EVALUATE_GUARD` now returns raw `abi.encode` bytes instead of JSON. Field order is: `bytes32 domain`, `bytes32 ruleId`, `bytes32 eventHash`, `bool triggered`, `uint256 protectedUsd18`, `uint16 protectBps`, `uint32 scheduleId`, `uint256 eventValueUsd18`, `uint64 evaluatedAt`, `uint256 nonce`, `uint64 resultExpiry`. The payload is exactly 352 bytes and uses `keccak256("AVERLOCK_GUARD_RESULT_V1")`.

Non-trigger results use the identical schema with protected amount, basis points, and schedule zeroed. Threshold, maximum-per-event, cooldown, policy expiry, and plaintext policy remain absent. CREATE_POLICY encryption and its minimal acknowledgment are unchanged.

Public calldata/events/results were scanned byte-for-byte. CREATE_POLICY exposed an `encryptedPolicy` ECIES ciphertext envelope, not plaintext terms. No plaintext threshold, maximum-per-event cap, cooldown, expiry, or complete policy appeared. Trigger-only execution fields such as protected amount, protection basis points, and schedule remain intentionally public. This demonstrates the approved simulated-TEE Coston2 flow, not production hardware attestation.

## Phase 6.3A V2 timing semantics (local only)

The V1 live image used the caller's XRPL event timestamp as `evaluatedAt` and started the 600-second result window from that old external-event time. This is incompatible with FDC finalization. The local V2 implementation removes `eventTimestamp` from `EVALUATE_GUARD` input and derives `evaluatedAt` from the trusted FCC instruction timestamp (`DataFixed.Timestamp`). Policy expiry and cooldown also use that trusted evaluation time. Client-supplied event timestamps are rejected by strict decoding.

The ABI remains 352 bytes and preserves its field order, but its domain is now `keccak256("AVERLOCK_GUARD_RESULT_V2")`. `resultExpiry` is `evaluatedAt + 600`. The XRPL payment time remains bound by the separately derived event hash and is not duplicated as FCC-controlled time.

V2 is not live. The existing PRODUCTION TEE remains evidence for V1/Phase 6.1 only until the rebuilt V2 image completes the applicable FCC version and TEE registration lifecycle.

## Safe reauthorization after expiry

Operational funding can outlive a 600-second authorization. FCC therefore records immutable authorization state per `(ruleId,eventHash)`: original event value, decision outcome, protected amount, public execution terms, and latest expiry. It rejects overlapping authorizations, reused nonces, changed values, expired policies, and events already consumed by the deployed GuardManager. Consumption is read directly from Coston2; callers cannot supply this flag, and RPC errors fail closed.

After the prior window has strictly expired, FCC may issue a new V2 signature with a fresh trusted `evaluatedAt`, expiry, and nonce. It preserves the original outcome and terms rather than recomputing them or applying cooldown as though another payment occurred. GuardManager independently rejects expired results and permanently consumes the event, ActionResult, and nonce when execution succeeds.
