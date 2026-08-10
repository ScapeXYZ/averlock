"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useAccount, useSwitchChain } from "wagmi";
import { Icon } from "@/components/dashboard/icons";
import { activityAnchors, readWalletActivity, type ActivityCategory, type ActivityData, type ActivityItem } from "@/lib/averlock/activity";
import { loadClaimReceipts } from "@/lib/averlock/activity-index";
import { contracts, coston2 } from "@/lib/averlock/config";
import { compactAddress, formatDate, formatToken } from "@/lib/averlock/format";
import { fetchGuardIndex } from "@/lib/averlock/guard-index";
import { devError, userFacingError } from "@/lib/averlock/errors";

const explorer = coston2.blockExplorers.default.url;
const filters: { label: string; value: "all" | ActivityCategory }[] = [{ label: "All", value: "all" }, { label: "Guards", value: "guards" }, { label: "Payments", value: "payments" }, { label: "Verification", value: "verification" }, { label: "Vaults", value: "vaults" }, { label: "Claims", value: "claims" }];
const icons: Record<string, string> = { "guard-created": "shield", "policy-commitment": "lock", "payment-verified": "proof", "ftso-snapshot": "price", "fcc-decision": "decision", "guard-triggered": "check", "vault-created": "vault", "vault-claim": "wallet" };

export function ActivityPage() {
  const { address, chainId, isConnected } = useAccount(); const { switchChain } = useSwitchChain();
  const [data, setData] = useState<ActivityData>(); const [error, setError] = useState(""); const [filter, setFilter] = useState<"all" | ActivityCategory>("all"); const [selected, setSelected] = useState<ActivityItem>();
  const refresh = useCallback(async () => {
    if (!address || chainId !== coston2.id) return;
    setError(""); setData(undefined);
    try { setData(await readWalletActivity(address, activityAnchors(await fetchGuardIndex(address)), loadClaimReceipts(address))); }
    catch (cause) { devError("activity read", cause); setError(userFacingError(cause, "Verified activity could not be loaded safely.")); }
  }, [address, chainId]);
  useEffect(() => { void Promise.resolve().then(refresh); }, [refresh]);
  const visible = useMemo(() => data?.items.filter((entry) => filter === "all" || entry.category === filter) || [], [data, filter]);

  if (!isConnected) return <main className="activity-page"><State icon="pulse" title="Connect your wallet" body="Connect the Coston2 wallet whose verifiable protection history you want to inspect."/></main>;
  if (chainId !== coston2.id) return <main className="activity-page"><State icon="shield" title="Coston2 required" body="Activity ownership and receipt bindings fail closed on any other network."><button className="primary-button" onClick={() => switchChain({ chainId: coston2.id })}>Switch to Coston2</button></State></main>;
  if (error) return <main className="activity-page"><State icon="lock" title="Activity verification stopped" body={error}/></main>;
  if (!data) return <main className="activity-page"><State icon="pulse" title="Verifying activity" body="Resolving exact receipt blocks and contract bindings from Coston2."/></main>;

  return <main className="activity-page">
    <header className="activity-hero"><div><p className="eyebrow">Public audit trail</p><h1>Activity</h1><p>Verifiable protection history, assembled from bounded Coston2 receipts and public protocol state.</p><div className="activity-identity"><span className="network-pill"><span/>Coston2</span><span><Icon name="wallet"/>{compactAddress(address, 12, 10)}</span></div></div><div className="activity-summary"><Summary label="Verified events" value={data.items.length.toString()}/><Summary label="Latest activity" value={data.items[0] ? formatDate(data.items[0].timestamp) : "No activity"}/></div></header>
    <section className="activity-content"><div className="activity-toolbar"><div><p className="eyebrow">Verified history</p><h2>Protection timeline</h2></div><div className="activity-filters" aria-label="Activity filters">{filters.map((entry) => <button key={entry.value} className={filter === entry.value ? "active" : ""} onClick={() => setFilter(entry.value)}>{entry.label}</button>)}</div></div>
      {data.warnings.length > 0 && <div className="activity-warning"><Icon name="pulse"/><p>Some optional history is unavailable. Verified core events remain visible. {data.warnings.join(" · ")}</p></div>}
      {!data.items.length ? <State icon="pulse" title="No verified activity yet" body="This wallet has no receipt-backed AVERLOCK guard or vault history."/> : !visible.length ? <State icon="pulse" title="No activity in this filter" body="No verified events match the selected category."/> : <div className="activity-timeline">{visible.map((entry) => <button className="activity-timeline-item" key={entry.id} onClick={() => setSelected(entry)} aria-label={`Inspect ${entry.title}`}><span className="activity-line-icon"><Icon name={icons[entry.type] || "check"}/></span><div className="activity-item-copy"><div><span className={`activity-state ${entry.status}`}>{entry.status}</span><span className="activity-source">{entry.source}</span></div><h3>{entry.title}</h3><p>{entry.description}</p><small>{formatDate(entry.timestamp)}{entry.ruleId ? ` · ${compactAddress(entry.ruleId, 10, 8)}` : ""}</small></div>{entry.amount !== undefined && <strong className="activity-amount">{formatToken(entry.amount)} <small>FTestXRP</small></strong>}<Icon className="activity-open" name="arrow"/></button>)}</div>}
    </section>
    <button className={`drawer-scrim ${selected ? "open" : ""}`} aria-label="Close activity details" onClick={() => setSelected(undefined)}/><aside className={`verify-drawer activity-drawer ${selected ? "open" : ""}`} aria-hidden={!selected} role="dialog" aria-modal="true" aria-label="Activity verification details">{selected && <ActivityDetail item={selected} onClose={() => setSelected(undefined)}/>}</aside>
  </main>;
}

function ActivityDetail({ item, onClose }: { item: ActivityItem; onClose: () => void }) { return <><header className="drawer-header"><div><p className="eyebrow">{item.source} verification</p><h2>{item.title}</h2></div><button aria-label="Close" onClick={onClose}><Icon name="close"/></button></header><p className="drawer-intro">{item.description}</p><div className="activity-detail-list"><Detail label="Status" value={item.status}/><Detail label="Network" value="Coston2 · Chain 114"/><Detail label="Timestamp" value={formatDate(item.timestamp)}/>{item.blockNumber !== undefined && <Detail label="Block / ledger" value={item.blockNumber.toString()}/>}<Detail label="Verification source" value={item.source}/>{item.ruleId && <Detail label="Rule ID" value={item.ruleId} mono/>}{item.eventHash && <Detail label="Event hash" value={item.eventHash} mono/>}{item.actionId && <Detail label="Action / result ID" value={item.actionId} mono/>}{item.positionId !== undefined && <Detail label="Position ID" value={item.positionId.toString()}/>} {item.amount !== undefined && <Detail label="Amount" value={`${formatToken(item.amount)} FTestXRP`}/>}<Detail label="Contract" value={item.source === "ProtectionVault" ? contracts.protectionVault : item.source === "GuardManager" ? contracts.guardManager : item.source === "FCC" ? contracts.instructionSender : "Public protocol evidence"} mono/></div>{item.transactionHash && <a className="activity-explorer" href={`${explorer}/tx/${item.transactionHash}`} target="_blank" rel="noreferrer">View verified transaction <Icon name="external"/></a>}{(item.type === "policy-commitment" || item.type === "fcc-decision") && <div className="privacy-note"><Icon name="lock"/><div><strong>Private policy sealed</strong><p>No threshold, protection terms, cooldown, expiry, or decrypted FCC input is rendered by this page.</p></div></div>}</>; }
function Detail({ label, value, mono }: { label: string; value: string; mono?: boolean }) { return <div><small>{label}</small><strong className={mono ? "mono" : ""}>{value}</strong></div>; }
function Summary({ label, value }: { label: string; value: string }) { return <div><small>{label}</small><strong>{value}</strong></div>; }
function State({ icon, title, body, children }: { icon: string; title: string; body: string; children?: React.ReactNode }) { return <div className="activity-empty"><span><Icon name={icon}/></span><h2>{title}</h2><p>{body}</p>{children}</div>; }
