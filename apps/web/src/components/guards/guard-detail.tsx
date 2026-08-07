"use client";

import { useEffect, useMemo, useState } from "react";
import { type Hex } from "viem";
import { useAccount } from "wagmi";
import { Icon } from "@/components/dashboard/icons";
import { contracts, coston2, fccConfig } from "@/lib/averlock/config";
import { compactAddress, formatDate, formatToken, formatUsd18, formatXrpFromSnapshot, relativeUnlock } from "@/lib/averlock/format";
import { configuredDetailAnchor, isValidGuardRuleId, readGuardDetail } from "@/lib/averlock/guard-detail";
import { loadGuardIndex } from "@/lib/averlock/guard-index";
import type { GuardDetailAnchor, GuardDetailData, GuardLifecycleStage } from "@/lib/averlock/types";
import { devError, userFacingError } from "@/lib/averlock/errors";
import { ProcessPaymentFlow } from "./process-payment-flow";

const explorer = coston2.blockExplorers.default.url;
const txLink = (hash?: Hex) => hash ? `${explorer}/tx/${hash}` : undefined;
const addressLink = (address: string) => `${explorer}/address/${address}`;

export function GuardDetail({ ruleId }: { ruleId: string }) {
  const { address, chainId, isConnected } = useAccount();
  const [data, setData] = useState<GuardDetailData>();
  const [error, setError] = useState("");
  const [indexRevision, setIndexRevision] = useState(0);
  const validRuleId = isValidGuardRuleId(ruleId);
  const anchor = useMemo<GuardDetailAnchor>(() => {
    // Receipt persistence increments this revision so localStorage is reconstructed immediately.
    void indexRevision;
    if (!validRuleId) return {};
    const configured = configuredDetailAnchor(ruleId as Hex) || {};
    const indexed = address ? loadGuardIndex(address).find((entry) => entry.ruleId.toLowerCase() === ruleId.toLowerCase()) : undefined;
    return { ...configured, owner: address, registrationBlock: indexed ? BigInt(indexed.registrationBlock) : configured.registrationBlock, registrationTransaction: indexed?.transactionHash || configured.registrationTransaction, eventHash: indexed?.eventHash || configured.eventHash, actionId: indexed?.actionId || configured.actionId, executionBlock: indexed?.executionBlock ? BigInt(indexed.executionBlock) : configured.executionBlock, executionTransaction: indexed?.executionTransaction || configured.executionTransaction };
  }, [address, indexRevision, ruleId, validRuleId]);

  useEffect(() => {
    if (!validRuleId || (isConnected && chainId !== coston2.id)) return;
    let cancelled = false;
    readGuardDetail(ruleId as Hex, anchor).then((value) => { if (!cancelled) setData(value); }).catch((cause) => { devError("guard detail", cause); if (!cancelled) setError(userFacingError(cause, "Guard verification could not be completed safely.")); });
    return () => { cancelled = true; };
  }, [anchor, chainId, isConnected, ruleId, validRuleId]);

  if (!validRuleId) return <DetailState title="Invalid rule ID" body="The URL must contain one canonical 32-byte AVERLOCK rule identifier."/>;
  if (isConnected && chainId !== coston2.id) return <DetailState title="Wrong network" body="Switch the connected wallet to Coston2 (chain ID 114). No state has been inferred."/>;
  if (error) return <DetailState title="Guard verification stopped" body={error}/>;
  if (!data) return <DetailState title="Verifying guard" body="Reading the guard and its receipt-anchored execution evidence from Coston2."/>;
  const receiptIndexed = () => { setError(""); setIndexRevision((value) => value + 1); };
  return <div className="guard-detail">
    <GuardHeader data={data}/>
    <div className="guard-detail-grid">
      <WatchedPayment data={data}/><PrivatePolicy data={data}/>
    </div>
    <Lifecycle stages={data.lifecycle}/>
    <div className="guard-detail-grid execution-grid">
      <Execution data={data} onReceiptIndexed={receiptIndexed}/><VaultPosition data={data}/>
    </div>
    <Verification data={data}/>
  </div>;
}

function GuardHeader({ data }: { data: GuardDetailData }) {
  const status = data.status === "executed" ? "Executed" : data.status === "expired" ? "Expired" : "Active";
  return <header className="guard-detail-hero"><div><div className={`guard-status ${data.status}`}><span/>{status}</div><p className="eyebrow">Protection guard</p><h1>{compactAddress(data.guard.ruleId, 14, 12)}</h1><p>Public execution metadata verified against the live Coston2 GuardManager.</p></div><div className="guard-hero-meta"><span className="network-pill"><span/>Coston2</span><Meta label="Owner" value={compactAddress(data.guard.owner, 12, 10)} href={addressLink(data.guard.owner)}/><Meta label="Registered" value={formatDate(data.guard.createdAt)}/><Meta label="Registration" value={data.registrationTransaction ? compactAddress(data.registrationTransaction, 10, 8) : "Receipt not indexed"} href={txLink(data.registrationTransaction)}/></div></header>;
}

function WatchedPayment({ data }: { data: GuardDetailData }) { return <Card eyebrow="Watched payment" title="XRP on XRPL" icon="wallet"><div className="guard-fact-list"><Fact label="Source network" value="XRPL"/><Fact label="Source asset" value="XRP"/><Fact label="Receiver hash" value={data.guard.monitoredReceiverHash} mono/><Fact label="Payment identity" value="Hashed for FDC verification"/></div><div className="sealed-message"><Icon name="lock"/><p>The watched XRPL destination is represented publicly only by its receiver hash. The original private policy is not exposed.</p></div></Card>; }

function PrivatePolicy({ data }: { data: GuardDetailData }) { return <Card eyebrow="Private FCC policy" title="Private policy sealed" icon="lock" badge="Commitment verified"><div className="guard-fact-list"><Fact label="Policy commitment" value={data.guard.policyCommitment} mono/><Fact label="FCC extension" value={data.extensionId.toString()}/><Fact label="Signed action/result" value={data.actionId || "Not yet available"} mono={Boolean(data.actionId)}/><Fact label="Verification" value={data.actionId ? "Signed decision recorded" : "Public guard binding verified"}/></div><div className="sealed-message dark"><Icon name="shield"/><p>Threshold, protection percentage, cap, cooldown, and expiry remain confidential and are never reconstructed by this page.</p></div></Card>; }

function Lifecycle({ stages }: { stages: GuardLifecycleStage[] }) { return <section className="guard-lifecycle"><div className="section-heading"><div><p className="eyebrow">Protection lifecycle</p><h2>Verified execution path</h2></div><p>Every state is derived from contract storage or a bounded receipt anchor.</p></div><div className="lifecycle-track">{stages.map((stage, index) => <div className="lifecycle-segment" key={stage.id}><div className={`lifecycle-stage ${stage.state}`}><span className="lifecycle-icon"><Icon name={stage.id === "payment" ? "wallet" : stage.id === "fdc" ? "proof" : stage.id === "ftso" ? "price" : stage.id === "fcc" ? "lock" : stage.id === "execution" ? "decision" : "vault"}/></span><span className="lifecycle-state">{stage.state === "executed" ? "Executed" : stage.state === "verified" ? "Verified" : stage.state === "unavailable" ? "Unavailable" : "Waiting"}</span><strong>{stage.label}</strong><p>{stage.detail}</p></div>{index < stages.length - 1 && <span className={`lifecycle-edge ${stage.state !== "waiting" ? "complete" : ""}`}><Icon name="arrow"/></span>}</div>)}</div></section>; }

function Execution({ data, onReceiptIndexed }: { data: GuardDetailData; onReceiptIndexed: () => void }) {
  if (!data.eventConsumed) return <Card eyebrow="Execution" title="Waiting for qualifying XRPL payment" icon="pulse"><div className="waiting-panel"><span><Icon name="pulse"/></span><p>No executed protection event is recorded for this receipt-backed guard. This is a normal waiting state, not an error.</p></div>{data.snapshot && <div className="guard-fact-list"><Fact label="Prepared event" value={data.eventHash || "—"} mono/><Fact label="Snapshot value" value={formatUsd18(data.snapshot.eventValueUsd18)}/><Fact label="Prepared" value={formatDate(data.snapshot.preparedAt)}/></div>}<ProcessPaymentFlow data={data} onReceiptIndexed={onReceiptIndexed}/></Card>;
  return <Card eyebrow="Execution" title={data.decisionTriggered === false ? "Guard evaluated — not triggered" : "Protection executed"} icon="decision" badge="Replay protected"><div className="guard-fact-list"><Fact label="FCC decision" value={data.decisionTriggered === false ? "Not triggered" : "Triggered"}/><Fact label="Event consumed" value="Yes"/><Fact label="Result consumed" value={data.resultConsumed ? "Yes" : "Unavailable"}/><Fact label="Event hash" value={data.eventHash || "—"} mono/><Fact label="Action/result ID" value={data.actionId || "—"} mono/><Fact label="Snapshot binding" value={data.snapshot ? `${formatXrpFromSnapshot(data.snapshot.eventValueUsd18, data.snapshot.priceUsd18)} · ${formatUsd18(data.snapshot.eventValueUsd18)}` : "Unavailable"}/><Fact label="Execution transaction" value={data.executionTransaction ? compactAddress(data.executionTransaction, 10, 8) : "Unavailable"} href={txLink(data.executionTransaction)}/></div></Card>;
}

function VaultPosition({ data }: { data: GuardDetailData }) {
  const position = data.position;
  if (!position) return <Card eyebrow="ProtectionVault" title={data.decisionTriggered === false ? "No position required" : "No vault position yet"} icon="vault"><div className="waiting-panel"><span><Icon name="vault"/></span><p>{data.decisionTriggered === false ? "The signed FCC decision did not trigger protection, so execution correctly created no vault position." : "A non-cancelable position appears only after a triggered FCC decision is executed."}</p></div></Card>;
  const released = position.totalDeposited ? Number((position.claimed + (data.claimable || 0n)) * 100n / position.totalDeposited) : 0;
  return <Card eyebrow="ProtectionVault" title={`Position #${position.id}`} icon="vault" badge="Onchain"><div className="detail-vault-amount"><span>Protected principal</span><strong>{formatToken(position.totalDeposited)} <small>FTestXRP</small></strong></div><div className="release-track"><div className="release-progress" style={{ width: `${Math.min(100, released)}%` }}/></div><div className="guard-fact-list"><Fact label="Claimable now" value={`${formatToken(data.claimable || 0n)} FTestXRP`}/><Fact label="Still locked" value={`${formatToken(data.remainingLocked || 0n)} FTestXRP`}/><Fact label="Beneficiary" value={compactAddress(position.beneficiary, 12, 10)} href={addressLink(position.beneficiary)}/><Fact label="Release start" value={formatDate(position.startTimestamp)}/><Fact label="Release end" value={formatDate(position.endTimestamp)}/><Fact label="Schedule" value={`30-day linear · ${relativeUnlock(position.endTimestamp)}`}/></div></Card>;
}

function Verification({ data }: { data: GuardDetailData }) { return <section className="guard-verification"><div className="section-heading"><div><p className="eyebrow">Public verification</p><h2>Contract bindings</h2></div><span className="verified-chip"><Icon name="check"/>Fail-closed checks passed</span></div><div className="verification-grid"><Fact label="GuardManager" value={contracts.guardManager} href={addressLink(contracts.guardManager)} mono/><Fact label="Rule ID" value={data.guard.ruleId} mono/><Fact label="Commitment" value={data.guard.policyCommitment} mono/><Fact label="Receiver hash" value={data.guard.monitoredReceiverHash} mono/><Fact label="Owner" value={data.guard.owner} href={addressLink(data.guard.owner)} mono/><Fact label="Chain" value="Coston2 · 114"/><Fact label="FCC extension" value={fccConfig.extensionId.toString()}/><Fact label="Schedule binding" value={`Schedule ${data.guard.scheduleId} · 30-day linear`}/></div>{data.optionalErrors.length > 0 && <div className="optional-warning"><Icon name="pulse"/><p>{data.optionalErrors.join(" · ")}. Core guard verification remains valid.</p></div>}</section>; }

function Card({ eyebrow, title, icon, badge, children }: { eyebrow: string; title: string; icon: string; badge?: string; children: React.ReactNode }) { return <section className="guard-detail-card full"><header><span className="guard-card-icon"><Icon name={icon}/></span><div><p className="eyebrow">{eyebrow}</p><h2>{title}</h2></div>{badge && <span className="verified-chip"><Icon name="check"/>{badge}</span>}</header>{children}</section>; }
function Fact({ label, value, mono, href }: { label: string; value: string; mono?: boolean; href?: string }) { const content = <span className={mono ? "mono" : ""}>{value}</span>; return <div className="guard-fact"><small>{label}</small>{href ? <a href={href} target="_blank" rel="noreferrer">{content}<Icon name="external"/></a> : content}</div>; }
function Meta({ label, value, href }: { label: string; value: string; href?: string }) { return <div><small>{label}</small>{href ? <a href={href} target="_blank" rel="noreferrer">{value}<Icon name="external"/></a> : <strong>{value}</strong>}</div>; }
function DetailState({ title, body }: { title: string; body: string }) { return <div className="guards-empty"><span><Icon name="shield"/></span><h2>{title}</h2><p>{body}</p></div>; }
