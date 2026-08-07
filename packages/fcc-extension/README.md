# AVERLOCK FCC extension

## Phase 6.1 canonical decision ABI

`EVALUATE_GUARD` now returns a fixed 352-byte ABI payload shared by `go/pkg/decision` and Solidity `FCCDecisionCodec`. Order: `bytes32 domain`, `bytes32 ruleId`, `bytes32 eventHash`, `bool triggered`, `uint256 protectedUsd18`, `uint16 protectBps`, `uint32 scheduleId`, `uint256 eventValueUsd18`, `uint64 evaluatedAt`, `uint256 nonce`, `uint64 resultExpiry`.

### Expired authorization refresh

The extension freezes the first decision for each `(ruleId,eventHash)`: canonical `eventValueUsd18`, trigger outcome, protected amount, basis points, and schedule. A second authorization is rejected while the first remains valid. After strict expiry it may be refreshed with a fresh nonce only when the value is identical, the policy remains valid, and a direct Coston2 read reports that GuardManager has not consumed the event. RPC failure fails closed. Refresh does not reapply cooldown, alter execution terms, update `LastTriggered`, or count as another economic trigger.

The decision remains the 352-byte `AVERLOCK_GUARD_RESULT_V2` schema. No signed field changes; this update changes authorization issuance lifecycle while GuardManager remains the authoritative execution replay barrier.

The live Phase 6.1 domain was `AVERLOCK_GUARD_RESULT_V1`; CREATE_POLICY encryption and acknowledgment remain unchanged. No private threshold, maximum, cooldown, policy expiry, or plaintext policy is included.

Phase 6.3A introduces a local-only V2 domain, `AVERLOCK_GUARD_RESULT_V2`. V2 keeps the 352-byte field order but changes `evaluatedAt` to the trusted FCC instruction timestamp and sets `resultExpiry` to that timestamp plus 600 seconds. The evaluation request no longer accepts a client-controlled event timestamp. This V2 image has not been deployed or registered.

The migrated image builds locally. To activate it on Coston2, preserve `config/extension.env` and the existing extension ID/InstructionSender, rebuild the extension-tee service, and register the new simulated TEE identity using post-build `rRap`. Do not rerun pre-build. Live action and privacy retests are required afterward.

In encrypted-keystore mode, `scripts/start-services.sh` starts Redis detached, gives ext-proxy a dedicated foreground TTY through `docker compose run --service-ports --use-aliases`, and starts extension-tee only after proxy port 6673 is listening. This avoids Compose `up` multiplexing the password terminal. Both the launcher and proxy reject non-empty raw-key variables in keystore mode; the encrypted keystore is mounted read-only and its password is read only from the attached terminal.

This directory contains the local Phase 5B implementation of `AVERLOCK_GUARD`, based on Flare's official `fce-extension-scaffold` at commit `f48cafb889441a62e47c083f4be8dd7d3f456f83`.

The Phase 5B.1 compatibility audit confirmed that this commit is still the current scaffold `main`. Infrastructure pins were advanced separately to the current FCC develop line required after the July 2026 Coston2 redeployment: tee-node `v0.0.24` and tee-proxy `v0.0.21-0.20260729123751-0c6d016b0994`. The Coston2 address bundle resolves `FlareTeeManager` to `0x1a9C4A0f9D76c0b1D91d22E24E573a9b377618aE`.

The Go extension supports two operations:

- `AVERLOCK_GUARD / CREATE_POLICY` decrypts an opaque policy with the scaffold TEE-node decrypt API, validates it, stores it in private extension memory, and returns only `ruleId`, `accepted`, and a deterministic policy commitment.
- `AVERLOCK_GUARD / EVALUATE_GUARD` evaluates public event context against that stored policy and returns a minimal decision. Triggered decisions include the execution terms needed by a future onchain executor.

## Historical Phase 5B scope

Phase 5B originally validated the rule engine locally with an explicitly test-only plaintext decryptor fixture. Phase 5C has since exercised the encrypted path through a registered simulated TEE on Coston2; the local fixtures alone remain insufficient evidence of production hardware confidentiality.

Production policy transport is designed as an opaque JSON envelope containing ciphertext. `AverlockInstructionSender.createPolicy` forwards that envelope without decoding or emitting it. The Go extension delegates decryption to the scaffold's TEE-node `/decrypt` endpoint; it implements no custom cryptography.

## Privacy boundary

Private extension state contains `thresholdUsd18`, `protectBps`, `scheduleId`, `maxPerEventUsd18`, `cooldownSeconds`, and `expiresAt`. The acknowledgement does not disclose those values. A public evaluation result never discloses threshold, cap, cooldown, policy expiry, or ciphertext. A triggered result intentionally discloses `protectBps` and `scheduleId`, plus calculated amounts, because a future GuardManager/executor will need them.

Detailed schemas, hashing rules, replay behavior, and limitations are in [the private-rules design](../../docs/fcc-private-rules.md).

## Local validation

From Ubuntu WSL:

```bash
cd packages/fcc-extension/go
go test -v ./...

cd ../
./scripts/generate-bindings.sh

docker build -f go/Dockerfile -t averlock-extension-tee:phase5b .
```

The Solidity transport lives at `contracts/InstructionSender.sol`; its generated Go binding is produced by `scripts/generate-bindings.sh`. Do not run `start-services.sh`, expose port 6674, or run Coston2 lifecycle scripts during Phase 5B.

## What comes later

FDC-derived XRP payment data, FTSOv2 valuation, GuardManager execution, and ProtectionVault coordination remain separate and are not integrated here. No Phase 6 work has begun.

## Phase 5C public Coston2 evidence

The current V2 ABI-capable simulated AVERLOCK TEE is registered as `0x1C2186F3c7573378445A51A9f3fAd2818e90F53a` under extension ID `0x10187` and reached manager status `2` (`PRODUCTION`). The deployed InstructionSender remains `0x530D307Cca3A01BfC9139934b3F5Fa1DA19E728D`, the current manager is `0x1a9C4A0f9D76c0b1D91d22E24E573a9b377618aE`, and the stable proxy is `https://crescentoid-earless-kelsi.ngrok-free.dev`. Live test tooling derives the TEE identity from `/info` and fails closed unless its manager record is `PRODUCTION`, belongs to extension `0x10187`, and records the same proxy URL. An explicitly supplied `TEE_ID` is preserved and cross-checked rather than overwritten by local configuration.

The live encrypted rule used public rule ID `0x1d5827daad9855308e3e978b21ef93be877a98e182529f2a994f37aac837e802` and returned commitment `0xaeee3b2e12d7304fe80789c807781b01fd26b7255aafcc2afa6583467d345ca7`. Public action evidence:

| Action | Transaction | Instruction/action ID | Result |
| --- | --- | --- | --- |
| CREATE_POLICY | `0xd4ad36b76f312797072d78aa01c80bfefd9ab3e85f68b158f7158dcae67550a5` | `0xf41a80a43e6e59f507b3e9041283db4581f6afb6d37db94dfbe24dc469cf3168` | Accepted; commitment recomputed exactly |
| Trigger | `0xc938057599e8630c6f9a11824607da75eddb83c973f9262cc52be230041ecf64` | `0x32bdeb75d087ef3a2667f03dfe5f1a292c3b3d0af6167ce3e748f3f1d4356664` | Triggered; protected USD18 `1400000000000000000000` |
| Replay | `0x843a78d4c9f57d380b1f2b7211cc0dad6ea9aae036cecd0794720529cb4b1227` | `0xe298d715878b99c7869e97a840f900263dc9f884fb513c8b86ef2ce976b396a7` | Signed failure; event/nonce replay rejected |
| Cooldown | `0x0cd187a62ea6bea0dc1a9dcf71f5a5cf462af00a928669ccc97dcf29884b7113` | `0xc4480531c6c1ac99ecc295aa21f8106ff165407df525fe88c37bf23b100b975e` | Fresh eligible event did not trigger inside cooldown |
| Non-trigger | `0x8423722d798e9cf1ad67714a9ace0232a333509d950093eee4849342e871af96` | `0x668cfa2c68921a71cd5fa74988eac60d3a6ea55fec25990e9859182c8b1944af` | Below-threshold event did not trigger |

All five ActionResults were re-fetched and verified against the registered TEE using the framework `TEE_ACTION_RESULT` domain and Coston2 chain ID 114. The trigger result hash was `0xf3b9bd927d045808092573ed9e7c8835268c4314bed0d732c6f102bf171b9c53`; the non-trigger result hash was `0x99b24c79cf31268d20b1c312a0eac5bb1e69d39fc30039f7fc20de380be8b026`.

The CREATE_POLICY calldata contained only an opaque ECIES ciphertext envelope. A byte-level scan of calldata, emitted manager events, and public results found no plaintext threshold, maximum-per-event cap, cooldown, expiry, or complete policy. This proves the simulated Coston2 encrypted execution path used here; it does not claim GCP Confidential Space hardware guarantees.

## Encrypted lifecycle signing

AVERLOCK's scaffold copy supports Ethereum V3 encrypted keystores for lifecycle transactions and the continuously running proxy. It uses `github.com/ethereum/go-ethereum/accounts/keystore`; it never invokes `cast wallet private-key` and never passes a decrypted key through environment variables, command arguments, files, or Docker image layers.

The one-off tools load signing material through `tools/pkg/signer`. In keystore mode they resolve the named file below `~/.foundry/keystores` (or an explicit local path), read the password from a terminal with echo disabled, decrypt once in process memory, and fail closed unless both the derived address and live RPC chain ID match configuration. Raw `DEPLOYMENT_PRIVATE_KEY` behavior remains available only with explicit `SIGNER_MODE=raw`.

Required untracked environment values are:

```text
SIGNER_MODE=keystore
DEPLOYMENT_KEYSTORE_ACCOUNT=<Foundry keystore filename>
EXPECTED_SIGNER_ADDRESS=0x<expected public address>
EXPECTED_CHAIN_ID=114
PROXY_SIGNER_MODE=keystore
PROXY_KEYSTORE_ACCOUNT=<Foundry keystore filename>
INITIAL_OWNER=0x<expected public address>
```

Passwords must not be added to `.env`. Verify an account without signing or broadcasting anything from an interactive WSL terminal:

```bash
cd packages/fcc-extension/tools
go run ./cmd/verify-signer -c https://coston2-api.flare.network/ext/C/rpc
```

The tee-proxy develop source still accepts only a raw environment key upstream. AVERLOCK applies the pinned overlay in `proxy/patches/keystore.patch` during its Docker build. The patched proxy mounts the encrypted keystore read-only at `/run/averlock-keystore/account`, prompts once on its attached terminal, verifies expected address and chain ID, and keeps the decrypted signer only in process memory. The encrypted keystore is never copied into the image.

Start Docker in keystore mode from a foreground terminal:

```bash
./scripts/start-services.sh --chain coston2
```

Keep that terminal attached because it owns the proxy password prompt and service logs; run later lifecycle commands from a second terminal. `--local` and `USE_LOCAL_SIBLINGS=1` fail closed in proxy keystore mode because those paths bypass the pinned overlay.

### Signing surface

| Surface | Location | Purpose | Keystore behavior |
| --- | --- | --- | --- |
| Lifecycle support | `tools/pkg/support.DefaultSupport` | Deploy, extension registration, tests, and most post-build transactions | Interactive encrypted-keystore load; raw mode retained explicitly |
| Alternate extension owner | `tools/cmd/allow-tee-version`, `tools/cmd/set-governance` | One-off post-build owner transactions | Reuses deployment keystore in keystore mode |
| Transaction helpers | `tools/pkg/utils`, `tools/pkg/fccutils` | One-off contract and registration calls | Receive the in-memory key from `Support`; no configuration secret |
| Docker ext-proxy | Pinned tee-proxy `config.PrivateKey` overlay | Continuous ActionResult and receipt signing | Read-only mount, one terminal prompt, process-lifetime memory only |
| Standalone Go start-tee | `go/cmd/start-tee.setOwnerAddress` | Local non-Docker owner derivation | Requires explicit `INITIAL_OWNER` in keystore mode; never decrypts a key |

Local tests generate disposable test-only keystores. The Anvil integration test funds only its generated local address through `anvil_setBalance`, signs one local transaction, confirms its receipt, and terminates Anvil. Automated tests never use the real AVERLOCK keystore.
