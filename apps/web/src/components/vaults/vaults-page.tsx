"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { getAddress } from "viem";
import { useAccount, usePublicClient, useSwitchChain, useWriteContract } from "wagmi";
import { Icon } from "@/components/dashboard/icons";
import { compactAddress, formatDate, formatToken, relativeUnlock } from "@/lib/averlock/format";
import { contracts, coston2 } from "@/lib/averlock/config";
import { vaultAbi } from "@/lib/averlock/contracts";
import { canClaimPosition, readWalletVaults, type VaultView, type VaultsData } from "@/lib/averlock/vaults";
import { saveClaimReceipt } from "@/lib/averlock/activity-index";
import { devError, userFacingError } from "@/lib/averlock/errors";

const explorer = coston2.blockExplorers.default.url;
const statusLabel = { locked: "Locked", releasing: "Releasing", "fully-vested": "Fully vested", claimed: "Claimed" } as const;

export function VaultsPage() {
  const { address, chainId, isConnected } = useAccount();
  const publicClient = usePublicClient({ chainId: coston2.id });
  const { switchChain } = useSwitchChain(); const { writeContractAsync } = useWriteContract();
  const [data, setData] = useState<VaultsData>(); const [error, setError] = useState(""); const [selected, setSelected] = useState<bigint>();
  const [claiming, setClaiming] = useState<bigint>(); const [claimMessage, setClaimMessage] = useState("");

  const refresh = useCallback(async () => {
    if (!address || chainId !== coston2.id) return;
    setError("");
    try { setData(await readWalletVaults(address)); } catch (cause) { devError("vault read", cause); setError(userFacingError(cause, "ProtectionVault state could not be loaded safely.")); }
  }, [address, chainId]);
  useEffect(() => { void Promise.resolve().then(refresh); }, [refresh]);

  async function claim(item: VaultView) {
    if (!address || !publicClient || !canClaimPosition(item, address, chainId || 0)) return;
    try {
      setClaiming(item.position.id); setClaimMessage("Simulating beneficiary claim…");
      const simulation = await publicClient.simulateContract({ address: contracts.protectionVault, abi: vaultAbi, functionName: "claim", args: [item.position.id], account: address });
      setClaimMessage("Awaiting wallet confirmation…");
      const hash = await writeContractAsync(simulation.request);
      setClaimMessage("Waiting for Coston2 confirmation…");
      const receipt = await publicClient.waitForTransactionReceipt({ hash, confirmations: 1 });
      if (receipt.status !== "success") throw new Error("Claim transaction reverted.");
      saveClaimReceipt({ kind: "claim", owner: address, positionId: item.position.id.toString(), transactionHash: hash, blockNumber: receipt.blockNumber.toString() });
      setClaimMessage("Claim confirmed."); await refresh();
    } catch (cause) { devError("vault claim", cause); setClaimMessage(userFacingError(cause, "The claim did not complete. No success state was assumed.")); }
    finally { setClaiming(undefined); }
  }

  if (!isConnected) return <main className="vaults-page"><PageState title="Connect your wallet" body="Connect the Coston2 wallet that is the beneficiary of your ProtectionVault positions."/></main>;
  if (chainId !== coston2.id) return <main className="vaults-page"><PageState title="Coston2 required" body="Vault state and beneficiary checks fail closed on any other network."><button className="primary-button" onClick={() => switchChain({ chainId: coston2.id })}>Switch to Coston2</button></PageState></main>;
  if (error) return <main className="vaults-page"><PageState title="Vault verification stopped" body={error}/></main>;
  if (!data) return <main className="vaults-page"><PageState title="Reading protection vaults" body="Verifying receipt-backed positions against the live Coston2 ProtectionVault."/></main>;

  return <main className="vaults-page">
    <header className="vaults-hero"><div><p className="eyebrow">ProtectionVault</p><h1>Protection Vaults</h1><p>Non-cancelable XRP protection positions releasing linearly to your connected wallet.</p><div className="vaults-owner"><span className="network-pill"><span/>Coston2</span><span><Icon name="wallet"/>{compactAddress(address, 12, 10)}</span></div></div><div className="vault-summary"><Summary label="Positions" value={data.positionCount.toString()}/><Summary label="Total protected" value={`${formatToken(data.totalProtected)} FTestXRP`}/><Summary label="Claimable" value={`${formatToken(data.totalClaimable)} FTestXRP`}/><Summary label="Still locked" value={`${formatToken(data.totalLocked)} FTestXRP`}/></div></header>
    {!data.positions.length ? <div className="vaults-empty"><span><Icon name="vault"/></span><h2>Your protection vault is empty.</h2><p>No receipt-backed ProtectionVault position belongs to this connected wallet.</p><Link className="primary-button" href="/guards">View Guards</Link></div> : <section className="vaults-content"><div className="section-heading"><div><p className="eyebrow">Your positions</p><h2>Protected assets</h2></div><p>{data.positions.length} verified position{data.positions.length === 1 ? "" : "s"}</p></div><div className="vault-position-list">{data.positions.map((item) => <VaultPositionCard key={item.position.id.toString()} item={item} selected={selected === item.position.id} onToggle={() => setSelected(selected === item.position.id ? undefined : item.position.id)} onClaim={() => claim(item)} claiming={claiming === item.position.id} claimMessage={claiming === item.position.id ? claimMessage : ""}/>)}</div></section>}
  </main>;
}

function VaultPositionCard({ item, selected, onToggle, onClaim, claiming, claimMessage }: { item: VaultView; selected: boolean; onToggle: () => void; onClaim: () => void; claiming: boolean; claimMessage: string }) {
  const p = item.position; const vested = p.totalDeposited ? p.claimed + (item.claimable || 0n) : 0n; const progress = p.totalDeposited ? Math.min(100, Number(vested * 100n / p.totalDeposited)) : 0;
  return <article className={`vault-position ${selected ? "open" : ""}`}><button className="vault-position-main" onClick={onToggle} aria-expanded={selected}><span className="vault-position-icon"><Icon name="vault"/></span><div className="vault-position-title"><p>Position #{p.id.toString()}</p><strong>{formatToken(p.totalDeposited)} FTestXRP</strong><small>{item.originatingRule ? `Guard ${compactAddress(item.originatingRule, 10, 8)}` : "Origin receipt unavailable"}</small></div><div className="vault-position-metric"><small>Claimable now</small><strong>{item.claimable === undefined ? "Unavailable" : formatToken(item.claimable)}</strong></div><div className="vault-position-metric"><small>Still locked</small><strong>{item.remainingLocked === undefined ? "Unavailable" : formatToken(item.remainingLocked)}</strong></div><span className={`vault-status ${item.status}`}>{statusLabel[item.status]}</span><Icon className="vault-chevron" name="arrow"/></button><div className="vault-progress"><span style={{ width: `${progress}%` }}/></div>{selected && <div className="vault-position-detail"><div className="vault-detail-grid"><Detail label="Original principal" value={`${formatToken(p.totalDeposited)} FTestXRP`}/><Detail label="Already claimed" value={`${formatToken(p.claimed)} FTestXRP`}/><Detail label="Claimable amount" value={item.claimable === undefined ? "Unavailable" : `${formatToken(item.claimable)} FTestXRP`}/><Detail label="Remaining locked" value={item.remainingLocked === undefined ? "Unavailable" : `${formatToken(item.remainingLocked)} FTestXRP`}/><Detail label="Beneficiary" value={p.beneficiary} mono/><Detail label="Asset" value={getAddress(p.asset) === getAddress(contracts.ftestXrp) ? "FTestXRP" : p.asset}/><Detail label="Release start" value={formatDate(p.startTimestamp)}/><Detail label="Release end" value={formatDate(p.endTimestamp)}/><Detail label="Schedule" value={`30-day linear · ${relativeUnlock(p.endTimestamp)}`}/><Detail label="Originating guard" value={item.originatingRule || "Not recoverable from receipt anchor"} mono={Boolean(item.originatingRule)}/></div><div className="vault-detail-footer"><div><Icon name="lock"/><span>Non-cancelable position · beneficiary-only claims</span></div>{item.executionTransaction && <a href={`${explorer}/tx/${item.executionTransaction}`} target="_blank" rel="noreferrer">Execution transaction <Icon name="external"/></a>}{item.claimable !== undefined && item.claimable > 0n && <button className="primary-button" disabled={claiming} onClick={onClaim}>{claiming ? "Claiming…" : `Claim ${formatToken(item.claimable)} FTestXRP`}</button>}</div>{claimMessage && <p className="claim-message" role="status">{claimMessage}</p>}{item.optionalErrors.length > 0 && <p className="vault-optional-warning"><Icon name="pulse"/>{item.optionalErrors.join(" · ")}</p>}</div>}</article>;
}

function Summary({ label, value }: { label: string; value: string }) { return <div><small>{label}</small><strong>{value}</strong></div>; }
function Detail({ label, value, mono }: { label: string; value: string; mono?: boolean }) { return <div><small>{label}</small><strong className={mono ? "mono" : ""}>{value}</strong></div>; }
function PageState({ title, body, children }: { title: string; body: string; children?: React.ReactNode }) { return <div className="vaults-empty state"><span><Icon name="vault"/></span><h2>{title}</h2><p>{body}</p>{children}</div>; }
