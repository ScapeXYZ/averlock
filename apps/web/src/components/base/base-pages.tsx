"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import {
  decodeEventLog,
  formatUnits,
  getAddress,
  parseUnits,
} from "viem";
import {
  useAccount,
  usePublicClient,
  useSwitchChain,
  useWriteContract,
} from "wagmi";
import { Icon } from "@/components/dashboard/icons";
import { TopNav } from "@/components/dashboard/top-nav";
import {
  baseContracts,
  basePublicClient,
  baseSepolia,
  deploymentConfigured,
} from "@/lib/base/config";
import {
  baseErc20Abi,
  baseGuardManagerAbi,
  baseVaultAbi,
  guardCreatedEvent,
} from "@/lib/base/contracts";
import {
  discoverActivity,
  guardStates,
  readGuard,
  readWallet,
  saveAnchor,
  type BaseGuard,
} from "@/lib/base/data";
import { compactAddress } from "@/lib/averlock/format";

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div className="base-shell">
      <TopNav />
      {children}
    </div>
  );
}
function State({
  title,
  body,
  action,
}: {
  title: string;
  body: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="base-state">
      <span>
        <Icon name="shield" />
      </span>
      <h2>{title}</h2>
      <p>{body}</p>
      {action}
    </div>
  );
}
function Header({
  eyebrow,
  title,
  body,
}: {
  eyebrow: string;
  title: string;
  body: string;
}) {
  return (
    <header className="base-page-header">
      <p className="eyebrow">{eyebrow}</p>
      <h1>{title}</h1>
      <p>{body}</p>
    </header>
  );
}
const duration = (seconds: bigint) =>
  seconds % 86400n === 0n
    ? `${seconds / 86400n} days`
    : `${seconds / 3600n} hours`;

function useWalletData() {
  const { address, chainId, isConnected } = useAccount();
  const [data, setData] = useState<Awaited<ReturnType<typeof readWallet>>>();
  const [error, setError] = useState("");
  const refresh = useCallback(async () => {
    if (!address || chainId !== baseSepolia.id) return;
    setError("");
    setData(undefined);
    try {
      setData(await readWallet(address));
    } catch (e) {
      setError(
        e instanceof Error ? e.message : "Base contract reads are unavailable.",
      );
    }
  }, [address, chainId]);
  useEffect(() => {
    void Promise.resolve().then(refresh);
  }, [refresh]);
  return { address, chainId, isConnected, data, error, refresh };
}

export function DashboardPage() {
  const { address, chainId, isConnected, data, error } = useWalletData();
  const { switchChain } = useSwitchChain();
  if (!isConnected)
    return (
      <Shell>
        <main className="base-page">
          <State
            title="Connect your wallet"
            body="Connect a wallet to read your AVERLOCK state directly from Base Sepolia."
          />
        </main>
      </Shell>
    );
  if (chainId !== baseSepolia.id)
    return (
      <Shell>
        <main className="base-page">
          <State
            title="Base Sepolia required"
            body="AVERLOCK will not read or submit against an unsupported network."
            action={
              <button
                className="primary-button"
                onClick={() => switchChain({ chainId: baseSepolia.id })}
              >
                Switch network
              </button>
            }
          />
        </main>
      </Shell>
    );
  if (error)
    return (
      <Shell>
        <main className="base-page">
          <State title="Current state unavailable" body={error} />
        </main>
      </Shell>
    );
  if (!data)
    return (
      <Shell>
        <main className="base-page">
          <State
            title="Reading Base contracts"
            body="Checking your known guards and vault positions. No cached value is shown as current state."
          />
        </main>
      </Shell>
    );
  const protectedTotal = data.positions.reduce(
    (sum, x) => sum + x.position.totalDeposited,
    0n,
  );
  const claimable = data.positions.reduce((sum, x) => sum + x.claimable, 0n);
  return (
    <Shell>
      <main className="base-page">
        <section className="base-dashboard-hero">
          <div>
            <span className="base-chip">Base Sepolia</span>
            <h1>Protection you can verify.</h1>
            <p>
              Transparent rules and non-cancelable vaults enforce the plan you
              chose.
            </p>
            <small>{address && compactAddress(address, 12, 10)}</small>
          </div>
          <Link className="primary-button" href="/guards/new">
            Create Protection Guard
          </Link>
        </section>
        {data.warning && <p className="base-warning">{data.warning}</p>}
        <section className="metric-grid">
          <Metric
            label="Total protected"
            value={`${formatUnits(protectedTotal, data.decimals)} ${data.symbol}`}
          />
          <Metric
            label="Claimable"
            value={`${formatUnits(claimable, data.decimals)} ${data.symbol}`}
          />
          <Metric
            label="Active guards"
            value={data.guards
              .filter((x) => ![6, 7].includes(x.guard.state))
              .length.toString()}
          />
          <Metric
            label="Vault positions"
            value={data.positions.length.toString()}
          />
        </section>
        <section className="base-panel">
          <div className="section-heading">
            <div>
              <p className="eyebrow">Current state</p>
              <h2>Your protection</h2>
            </div>
            <Link href="/guards">View all guards</Link>
          </div>
          {data.guards.length ? (
            <GuardCards
              items={data.guards.map((x) => x.guard)}
              decimals={data.decimals}
              symbol={data.symbol}
            />
          ) : (
            <State
              title="No protection guards yet"
              body="Create your first guard to commit approved ERC-20 funds to a release plan."
              action={
                <Link className="primary-button" href="/guards/new">
                  Create Guard
                </Link>
              }
            />
          )}
        </section>
      </main>
    </Shell>
  );
}
function Metric({ label, value }: { label: string; value: string }) {
  return (
    <article className="metric-card">
      <small>{label}</small>
      <strong>{value}</strong>
    </article>
  );
}

export function GuardsPage() {
  const { chainId, isConnected, data, error } = useWalletData();
  if (!isConnected)
    return (
      <Shell>
        <main className="base-page">
          <State
            title="Connect your wallet"
            body="Guard discovery is scoped to the connected owner."
          />
        </main>
      </Shell>
    );
  if (chainId !== baseSepolia.id)
    return (
      <Shell>
        <main className="base-page">
          <State
            title="Unsupported network"
            body="Switch to Base Sepolia to view guards."
          />
        </main>
      </Shell>
    );
  return (
    <Shell>
      <main className="base-page">
        <Header
          eyebrow="Protection Guards"
          title="Your rules"
          body="Discovery comes from AVERLOCK events; every status shown here is re-read from the contract."
        />
        {error ? (
          <State title="Guards unavailable" body={error} />
        ) : !data ? (
          <State
            title="Reading guards"
            body="Verifying current guard state on Base Sepolia."
          />
        ) : (
          <>
            {data.warning && <p className="base-warning">{data.warning}</p>}
            {data.guards.length ? (
              <GuardCards
                items={data.guards.map((x) => x.guard)}
                decimals={data.decimals}
                symbol={data.symbol}
              />
            ) : (
              <State
                title="No guards discovered"
                body="No confirmed guard IDs are available for this wallet."
                action={
                  <Link className="primary-button" href="/guards/new">
                    Create Guard
                  </Link>
                }
              />
            )}
          </>
        )}
      </main>
    </Shell>
  );
}
function GuardCards({
  items,
  decimals,
  symbol,
}: {
  items: BaseGuard[];
  decimals: number;
  symbol: string;
}) {
  return (
    <div className="base-card-grid">
      {items.map((g) => (
        <Link
          href={`/guards/${g.id}`}
          className="base-guard-card"
          key={g.id.toString()}
        >
          <span>
            <Icon name={g.guardType === 0 ? "lock" : "shield"} />
          </span>
          <div>
            <small>
              {g.guardType === 0
                ? "Cooldown protection"
                : "Stablecoin protection"}
            </small>
            <h3>
              {formatUnits(g.amount, decimals)} {symbol}
            </h3>
            <p>
              {duration(g.cooldown)} cooldown · {duration(g.releaseDuration)}{" "}
              release
            </p>
          </div>
          <b>{guardStates[g.state] || "Unknown"}</b>
        </Link>
      ))}
    </div>
  );
}

export function GuardDetailPage({ guardId }: { guardId: string }) {
  const { address, chainId } = useAccount();
  const [guard, setGuard] = useState<BaseGuard>();
  const [meta, setMeta] = useState({ symbol: "", decimals: 18 });
  const [error, setError] = useState("");
  const [busy, setBusy] = useState("");
  const { writeContractAsync } = useWriteContract();
  const client = usePublicClient({ chainId: baseSepolia.id });
  const load = useCallback(async () => {
    try {
      const g = await readGuard(BigInt(guardId));
      const [symbol, decimals] = await Promise.all([
        basePublicClient.readContract({
          address: g.asset,
          abi: baseErc20Abi,
          functionName: "symbol",
        }),
        basePublicClient.readContract({
          address: g.asset,
          abi: baseErc20Abi,
          functionName: "decimals",
        }),
      ]);
      setGuard(g);
      setMeta({ symbol, decimals: Number(decimals) });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Guard unavailable.");
    }
  }, [guardId]);
  useEffect(() => {
    void Promise.resolve().then(load);
  }, [load]);
  async function act(kind: "fund" | "execute" | "deactivate" | "complete") {
    if (!guard || !address || !client) return;
    setBusy(kind);
    setError("");
    try {
      if (kind === "fund") {
        const allowance = await basePublicClient.readContract({
          address: guard.asset,
          abi: baseErc20Abi,
          functionName: "allowance",
          args: [address, baseContracts.guardManager],
        });
        if (allowance < guard.amount) {
          const approval = await writeContractAsync({
            address: guard.asset,
            abi: baseErc20Abi,
            functionName: "approve",
            args: [baseContracts.guardManager, guard.amount],
            chainId: baseSepolia.id,
          });
          await client.waitForTransactionReceipt({ hash: approval });
        }
      }
      const fn =
        kind === "fund"
          ? "fundGuard"
          : kind === "execute"
            ? "executeGuard"
            : kind === "deactivate"
              ? "deactivateGuard"
              : "completeGuard";
      await client.simulateContract({
        address: baseContracts.guardManager,
        abi: baseGuardManagerAbi,
        functionName: fn,
        args: [guard.id],
        account: address,
      });
      const hash = await writeContractAsync({
        address: baseContracts.guardManager,
        abi: baseGuardManagerAbi,
        functionName: fn,
        args: [guard.id],
        chainId: baseSepolia.id,
      });
      const receipt = await client.waitForTransactionReceipt({ hash });
      if (receipt.status !== "success")
        throw new Error("The transaction reverted.");
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Transaction stopped.");
    } finally {
      setBusy("");
    }
  }
  if (chainId !== baseSepolia.id)
    return (
      <Shell>
        <main className="base-page">
          <State
            title="Base Sepolia required"
            body="Switch networks to inspect this guard."
          />
        </main>
      </Shell>
    );
  return (
    <Shell>
      <main className="base-page">
        {error && <p className="base-error">{error}</p>}
        {!guard ? (
          <State
            title="Reading guard"
            body="Loading authoritative contract state."
          />
        ) : (
          <>
            <Header
              eyebrow={`Guard #${guard.id}`}
              title={
                guard.guardType === 0
                  ? "Cooldown Protection"
                  : "Stablecoin Protection"
              }
              body="This guard's amount and schedule are immutable."
            />
            <section className="base-panel detail-grid">
              <Metric
                label="Current state"
                value={guardStates[guard.state] || "Unknown"}
              />
              <Metric
                label="Protected amount"
                value={`${formatUnits(guard.amount, meta.decimals)} ${meta.symbol}`}
              />
              <Metric label="Cooldown" value={duration(guard.cooldown)} />
              <Metric label="Release" value={duration(guard.releaseDuration)} />
            </section>
            <section className="base-panel action-row">
              <div>
                <h2>Next action</h2>
                <p>
                  {guard.state === 1
                    ? "Approve the exact amount and arm this guard. Once funded, it cannot be deactivated."
                    : guard.state === 2 || guard.state === 3
                      ? "Execution is permissionless once the cooldown has elapsed."
                      : guard.state === 5
                        ? "Funds are in the non-cancelable vault and release according to schedule."
                        : "No action is currently required."}
                </p>
              </div>
              {guard.state === 1 && (
                <>
                  <button
                    className="secondary-button"
                    disabled={!!busy}
                    onClick={() => act("deactivate")}
                  >
                    Deactivate
                  </button>
                  <button
                    className="primary-button"
                    disabled={!!busy}
                    onClick={() => act("fund")}
                  >
                    {busy ? "Working…" : "Approve & arm"}
                  </button>
                </>
              )}
              {(guard.state === 2 || guard.state === 3) && (
                <button
                  className="primary-button"
                  disabled={!!busy}
                  onClick={() => act("execute")}
                >
                  {busy ? "Working…" : "Execute protection"}
                </button>
              )}
              {guard.state === 5 && (
                <Link className="primary-button" href="/vaults">
                  View vault
                </Link>
              )}
            </section>
          </>
        )}
      </main>
    </Shell>
  );
}

export function VaultsPage() {
  const { address, chainId, data, error, refresh } = useWalletData();
  const { writeContractAsync } = useWriteContract();
  const client = usePublicClient({ chainId: baseSepolia.id });
  const [busy, setBusy] = useState<bigint>();
  async function claim(id: bigint) {
    if (!address || !client) return;
    setBusy(id);
    try {
      await client.simulateContract({
        address: baseContracts.protectionVault,
        abi: baseVaultAbi,
        functionName: "claim",
        args: [id],
        account: address,
      });
      const hash = await writeContractAsync({
        address: baseContracts.protectionVault,
        abi: baseVaultAbi,
        functionName: "claim",
        args: [id],
        chainId: baseSepolia.id,
      });
      await client.waitForTransactionReceipt({ hash });
      await refresh();
    } finally {
      setBusy(undefined);
    }
  }
  return (
    <Shell>
      <main className="base-page">
        <Header
          eyebrow="Protection Vaults"
          title="Committed funds"
          body="Vault balances and claimable amounts are read directly from Base Sepolia."
        />
        {!address ? (
          <State
            title="Connect your wallet"
            body="Connect the beneficiary wallet."
          />
        ) : chainId !== baseSepolia.id ? (
          <State
            title="Base Sepolia required"
            body="Vault actions are disabled on other networks."
          />
        ) : error ? (
          <State title="Vaults unavailable" body={error} />
        ) : !data ? (
          <State
            title="Reading vaults"
            body="Checking positions and release state."
          />
        ) : !data.positions.length ? (
          <State
            title="No vault positions"
            body="A position appears here after an armed guard is executed."
          />
        ) : (
          <div className="base-card-grid">
            {data.positions.map((x) => (
              <article
                className="base-vault-card"
                key={x.position.id.toString()}
              >
                <div>
                  <small>Position #{x.position.id.toString()}</small>
                  <h3>
                    {formatUnits(x.position.totalDeposited, data.decimals)}{" "}
                    {data.symbol}
                  </h3>
                  <p>
                    {formatUnits(x.locked, data.decimals)} locked ·{" "}
                    {formatUnits(x.claimable, data.decimals)} claimable
                  </p>
                </div>
                <button
                  className="primary-button"
                  disabled={x.claimable === 0n || busy === x.position.id}
                  onClick={() => claim(x.position.id)}
                >
                  {busy === x.position.id ? "Claiming…" : "Claim available"}
                </button>
              </article>
            ))}
          </div>
        )}
      </main>
    </Shell>
  );
}

export function ActivityPage() {
  const { address, chainId } = useAccount();
  const [items, setItems] = useState<Awaited<ReturnType<typeof discoverActivity>>["items"]>([]);
  const [warning, setWarning] = useState("");
  useEffect(() => {
    if (address && chainId === baseSepolia.id)
      discoverActivity(address).then((x) => {
        setItems(x.items);
        setWarning(x.warning || "");
      });
  }, [address, chainId]);
  return (
    <Shell>
      <main className="base-page">
        <Header
          eyebrow="On-chain activity"
          title="Protection history"
          body="Confirmed AVERLOCK event anchors only. Current state is always read from contracts."
        />
        {warning && <p className="base-warning">{warning}</p>}
        {!address ? (
          <State
            title="Connect your wallet"
            body="Activity is scoped to the connected owner."
          />
        ) : !items.length ? (
          <State
            title="No activity discovered"
            body="No confirmed AVERLOCK transactions are available for this wallet."
          />
        ) : (
          <div className="activity-simple">
            {items.map((x) => (
              <a
                key={`${x.transaction_hash}-${x.event_name}`}
                href={`${baseSepolia.blockExplorers.default.url}/tx/${x.transaction_hash}`}
                target="_blank"
                rel="noreferrer"
              >
                <span>
                  <Icon name="shield" />
                </span>
                <div>
                  <strong>{x.event_name.replace(/([a-z])([A-Z])/g, "$1 $2")}</strong>
                  <small>{x.payload.guardId ? `Guard #${x.payload.guardId} · ` : ""}Block {x.block_number}</small>
                </div>
                <Icon name="external" />
              </a>
            ))}
          </div>
        )}
      </main>
    </Shell>
  );
}

export function SettingsPage() {
  const { address, chainId } = useAccount();
  const [version, setVersion] = useState("Unavailable");
  const [rpc, setRpc] = useState("Checking…");
  useEffect(() => {
    Promise.all([
      basePublicClient.getChainId(),
      deploymentConfigured
        ? basePublicClient.readContract({
            address: baseContracts.guardManager,
            abi: baseGuardManagerAbi,
            functionName: "VERSION",
          })
        : Promise.reject(new Error()),
    ])
      .then(([id, v]) => {
        setRpc(id === baseSepolia.id ? "Available" : "Wrong chain");
        setVersion(String(v));
      })
      .catch(() => setRpc("Unavailable"));
  }, []);
  return (
    <Shell>
      <main className="base-page">
        <Header
          eyebrow="Settings / Network"
          title="Base connection"
          body="Deployment and network details are shown without fallback addresses."
        />
        <section className="base-panel settings-list">
          <Row label="Connected wallet" value={address || "Not connected"} />
          <Row
            label="Connected chain"
            value={chainId ? `${chainId}` : "Not connected"}
          />
          <Row label="Product network" value="Base Sepolia · 84532" />
          <Row
            label="RPC / contracts"
            value={deploymentConfigured ? rpc : "Not configured"}
          />
          <Row label="Contract version" value={version} />
          <Row
            label="GuardManager"
            value={baseContracts.guardManager}
            link={`${baseSepolia.blockExplorers.default.url}/address/${baseContracts.guardManager}`}
          />
          <Row
            label="ProtectionVault"
            value={baseContracts.protectionVault}
            link={`${baseSepolia.blockExplorers.default.url}/address/${baseContracts.protectionVault}`}
          />
          <Row
            label="Approved token"
            value={baseContracts.approvedToken}
            link={`${baseSepolia.blockExplorers.default.url}/address/${baseContracts.approvedToken}`}
          />
        </section>
      </main>
    </Shell>
  );
}
function Row({
  label,
  value,
  link,
}: {
  label: string;
  value: string | number;
  link?: string;
}) {
  return (
    <div>
      <small>{label}</small>
      {link && deploymentConfigured ? (
        <a href={link} target="_blank" rel="noreferrer">
          {value}
          <Icon name="external" />
        </a>
      ) : (
        <strong>{value}</strong>
      )}
    </div>
  );
}

export function CreateGuardPage() {
  const router = useRouter();
  const { address, chainId, isConnected } = useAccount();
  const { switchChain } = useSwitchChain();
  const client = usePublicClient({ chainId: baseSepolia.id });
  const { writeContractAsync } = useWriteContract();
  const [form, setForm] = useState({
    type: "0",
    amount: "",
    cooldownDays: "7",
    releaseDays: "30",
  });
  const [meta, setMeta] = useState({
    symbol: "approved token",
    decimals: 18,
    balance: 0n,
  });
  const [status, setStatus] = useState("");
  const [error, setError] = useState("");
  useEffect(() => {
    if (address && deploymentConfigured)
      Promise.all([
        basePublicClient.readContract({
          address: baseContracts.approvedToken,
          abi: baseErc20Abi,
          functionName: "symbol",
        }),
        basePublicClient.readContract({
          address: baseContracts.approvedToken,
          abi: baseErc20Abi,
          functionName: "decimals",
        }),
        basePublicClient.readContract({
          address: baseContracts.approvedToken,
          abi: baseErc20Abi,
          functionName: "balanceOf",
          args: [address],
        }),
      ])
        .then(([symbol, decimals, balance]) =>
          setMeta({ symbol, decimals: Number(decimals), balance }),
        )
        .catch(() => setError("Approved-token metadata is unavailable."));
  }, [address]);
  const amount = (() => {
    try {
      return parseUnits(form.amount || "0", meta.decimals);
    } catch {
      return 0n;
    }
  })();
  async function submit() {
    if (!address || !client || amount <= 0n) return;
    setError("");
    setStatus("Simulating guard creation…");
    try {
      const args = [
        Number(form.type),
        baseContracts.approvedToken,
        amount,
        BigInt(form.cooldownDays) * 86400n,
        BigInt(form.releaseDays) * 86400n,
      ] as const;
      await client.simulateContract({
        address: baseContracts.guardManager,
        abi: baseGuardManagerAbi,
        functionName: "createGuard",
        args,
        account: address,
      });
      setStatus("Confirm guard creation in your wallet…");
      const hash = await writeContractAsync({
        address: baseContracts.guardManager,
        abi: baseGuardManagerAbi,
        functionName: "createGuard",
        args,
        chainId: baseSepolia.id,
      });
      setStatus("Waiting for Base Sepolia confirmation…");
      const receipt = await client.waitForTransactionReceipt({ hash });
      if (receipt.status !== "success")
        throw new Error("Guard creation reverted.");
      let id: bigint | undefined;
      for (const log of receipt.logs) {
        try {
          const decoded = decodeEventLog({
            abi: [guardCreatedEvent],
            data: log.data,
            topics: log.topics,
          });
          if (
            decoded.eventName === "GuardCreated" &&
            getAddress(decoded.args.owner) === getAddress(address)
          ) {
            id = decoded.args.guardId;
            break;
          }
        } catch {}
      }
      if (id === undefined)
        throw new Error(
          "Confirmed transaction did not contain the expected GuardCreated event.",
        );
      saveAnchor({
        guardId: id.toString(),
        transactionHash: hash,
        blockNumber: receipt.blockNumber.toString(),
        owner: address,
      });
      setStatus("Guard verified. Opening its current state…");
      router.push(`/guards/${id}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Creation stopped.");
      setStatus("");
    }
  }
  return (
    <Shell>
      <main className="base-page">
        <Header
          eyebrow="Create Guard"
          title="Commit to your protection plan"
          body="Choose a transparent rule, fund it after creation, then execute it into a non-cancelable vault when eligible."
        />
        {!deploymentConfigured ? (
          <State
            title="Deployment not configured"
            body="Base Sepolia contract addresses must be configured before a real guard can be created."
          />
        ) : !isConnected ? (
          <State
            title="Connect your wallet"
            body="A connected owner is required to register a guard."
          />
        ) : chainId !== baseSepolia.id ? (
          <State
            title="Base Sepolia required"
            body="Guard creation is disabled on other networks."
            action={
              <button
                className="primary-button"
                onClick={() => switchChain({ chainId: baseSepolia.id })}
              >
                Switch network
              </button>
            }
          />
        ) : (
          <section className="create-base-grid">
            <div className="base-panel form-stack">
              <label>
                Protection type
                <select
                  value={form.type}
                  onChange={(e) => setForm({ ...form, type: e.target.value })}
                >
                  <option value="0">Cooldown / Manual Protection</option>
                  <option value="1">Stablecoin Protection</option>
                </select>
              </label>
              <label>
                Approved asset
                <input
                  value={`${meta.symbol} · ${compactAddress(baseContracts.approvedToken)}`}
                  disabled
                />
              </label>
              <label>
                Amount
                <input
                  type="number"
                  min="0"
                  step="any"
                  value={form.amount}
                  onChange={(e) => setForm({ ...form, amount: e.target.value })}
                  placeholder="500"
                />
                <small>
                  Wallet balance: {formatUnits(meta.balance, meta.decimals)}{" "}
                  {meta.symbol}
                </small>
              </label>
              <label>
                Cooldown before vault execution
                <input
                  type="number"
                  min="0"
                  max="365"
                  value={form.cooldownDays}
                  onChange={(e) =>
                    setForm({ ...form, cooldownDays: e.target.value })
                  }
                />
                <small>days</small>
              </label>
              <label>
                Linear release duration
                <input
                  type="number"
                  min="1"
                  max="365"
                  value={form.releaseDays}
                  onChange={(e) =>
                    setForm({ ...form, releaseDays: e.target.value })
                  }
                />
                <small>days</small>
              </label>
            </div>
            <aside className="base-panel review-card">
              <p className="eyebrow">Review</p>
              <h2>
                You are protecting {form.amount || "0"} {meta.symbol}.
              </h2>
              <p>
                After you separately approve and arm this guard, the committed
                funds cannot be deactivated. Following a {form.cooldownDays}-day
                cooldown, execution creates an AVERLOCK vault with a{" "}
                {form.releaseDays}-day linear release.
              </p>
              <div className="base-notice">
                <Icon name="lock" />
                <span>
                  Creation does not move tokens. Funding is a separate, explicit
                  transaction with an exact allowance.
                </span>
              </div>
              {error && <p className="base-error">{error}</p>}
              {status && <p className="base-status">{status}</p>}
              <button
                className="primary-button"
                disabled={!!status || amount <= 0n || amount > meta.balance}
                onClick={submit}
              >
                Create Protection Guard
              </button>
            </aside>
          </section>
        )}
      </main>
    </Shell>
  );
}
