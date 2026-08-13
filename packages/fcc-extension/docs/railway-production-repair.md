# Railway FCC production repair

This runbook is intentionally fail-closed.  Do not deploy a GuardManager or
submit an evaluation until every runtime check below passes.

## Why a volume cannot restore the old TEE ID

The pinned `tee-node` calls `crypto.GenerateKey()` during `node.Initialize` on
every process boot.  It does not read a TEE identity private key, seed,
keystore, or state directory.  Therefore `INITIAL_OWNER`,
`PROXY_KEYSTORE_*`, Redis, and a Railway volume cannot derive or restore a
previous TEE ID.  `INITIAL_OWNER` controls governance only; the proxy keystore
signs proxy responses only.

The registered ID `0xbAd2a9e9c836efEB970b6b42A04208ee9B8D4E71` can be used
only if its original process is still alive.  It cannot be recovered from the
current Railway deployment.  Never copy an EOA key into this workload to fake
that identity: doing so weakens the TEE trust boundary.

## extension-tee Railway variables

Set these in the `extension-tee` service, preserving all existing secret
values and the shared Redis configuration:

```
CHAIN_URL=https://coston2-api.flare.network/ext/C/rpc
COSTON2_RPC_URL=https://coston2-api.flare.network/ext/C/rpc
CHAIN_ID=114
EXTENSION_ID=65927
PROXY_URL=http://chic-essence.railway.internal:6663
EXT_PROXY_URL=https://chic-essence-production.up.railway.app
EXT_PROXY_HOST_URL=https://chic-essence-production.up.railway.app
FCC_STATE_STORE=redis
REDIS_URL=${{Redis.REDIS_URL}}
```

Keep `INITIAL_OWNER`, `GOVERNANCE_SIGNERS`, `GOVERNANCE_THRESHOLD`,
`FCC_STATE_SEAL_KEY`, and the existing proxy signer variables unchanged.  Do
not add a TEE private-key/keystore variable or volume: this tee-node release
does not support one and a fabricated persistent key is not an attested TEE
identity.

Adding `CHAIN_URL` requires an extension-tee restart.  That restart creates a
new TEE identity.  Register and promote exactly that freshly reported identity
with the existing TEE-manager governance process before any GuardManager is
deployed.  Record it as `GUARD_MANAGER_TEE_ID`; never assume `0xbAd...4E71`
will survive the restart.

## Runtime gate before GuardManager deployment

After the restart, first require a log line showing that the signing policy is
initialized.  Then use the permanent public proxy:

```
curl -fsS https://chic-essence-production.up.railway.app/info
```

Derive the address from the returned public key and verify on Coston2 that the
same address has `getTeeMachineStatus == 2`, `getExtensionId == 65927`, proxy
`0x8E4f5D2736B988D4e922b988FF89bcCde45C6f2f`, and URL exactly
`https://chic-essence-production.up.railway.app`.  Only then require all of:

* periodic `TEE_INFO` responses succeed without `invalid teeID`;
* no `signing policy not initialized` errors occur;
* DirectQueue, MainQueue, and BackupQueue all drain after their normal
  health actions; and
* a disposable, non-Guard `TEE_INFO`/health action yields a stored proxy
  result.

The proxy must continue rejecting any response whose recovered signer differs
from the registered TEE.  Do not weaken that validation.

## GuardManager deployment gate

`DeployGuardManagerV2.s.sol` reads, and validates before `startBroadcast`:

```
GUARD_MANAGER_TEE_ID=<the newly registered production tee from /info>
GUARD_MANAGER_TEE_URL=https://chic-essence-production.up.railway.app
```

It checks the TEE manager record, status 2, extension 65927, proxy, URL,
FDC/FTSO addresses, fAsset, verifier source ID, deployed dependency bytecode,
and a non-zero live price.  It then deploys only a new GuardManager.  Do not
pass `--broadcast` until the simulation succeeds and the fresh TEE record is
confirmed.

## Post-deployment service configuration

Use the printed new GuardManager address in these services, then redeploy only
the applications that consume it:

```
# extension-tee
AVERLOCK_GUARD_MANAGER=<new GuardManager>

# web build/runtime
NEXT_PUBLIC_AVERLOCK_GUARD_MANAGER=<new GuardManager>
NEXT_PUBLIC_AVERLOCK_TEE_ID=<fresh registered production tee>
AVERLOCK_FCC_PROXY_URL=https://chic-essence-production.up.railway.app
AVERLOCK_FCC_RESULT_PROXY_URL=https://chic-essence-production.up.railway.app
```

Also update the event-indexer `AVERLOCK_CONTRACT_ADDRESSES` to append/replace
the old GuardManager with the new address while retaining ProtectionVault.
Keep the FDC verifier credential, FDC/FTSO addresses, FCC Redis state/seal key,
proxy URL, and the web `prepareGuardEvaluation` 500000 gas limit unchanged.
