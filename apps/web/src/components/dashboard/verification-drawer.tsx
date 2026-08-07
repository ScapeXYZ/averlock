"use client";

import type { DashboardData } from "@/lib/averlock/types";
import { contracts, coston2 } from "@/lib/averlock/config";
import { compactAddress, formatDate, formatUsd18 } from "@/lib/averlock/format";
import { Icon } from "./icons";

const ExplorerLink = ({ hash, children }: { hash?: `0x${string}`; children: React.ReactNode }) => hash ? <a href={`${coston2.blockExplorers.default.url}/tx/${hash}`} target="_blank" rel="noreferrer">{children}<Icon name="external"/></a> : <span>—</span>;

export function VerificationDrawer({ open, onClose, data }: { open: boolean; onClose: () => void; data: DashboardData }) {
  return <><button className={`drawer-scrim ${open ? "open" : ""}`} onClick={onClose} aria-label="Close verification drawer" tabIndex={open ? 0 : -1}/><aside className={`verify-drawer ${open ? "open" : ""}`} aria-hidden={!open} aria-label="Verification evidence" role="dialog" aria-modal="true">
    <div className="drawer-header"><div><p className="eyebrow">Public evidence</p><h2>Verify protection</h2></div><button onClick={onClose} aria-label="Close"><Icon name="close"/></button></div>
    <p className="drawer-intro">Protocol detail stays secondary, but every public execution boundary remains independently inspectable.</p>
    <div className="verify-list">
      <VerifyRow title="GuardManager" status="Verified" detail={compactAddress(contracts.guardManager, 10, 8)} tx={data.transactions.registration}/>
      <VerifyRow title="FDC payment proof" status={data.snapshot ? "Verified" : "Pending"} detail={data.snapshot ? "Accepted before snapshot" : "No prepared event"} tx={data.transactions.preparation}/>
      <VerifyRow title="FTSO snapshot" status={data.snapshot ? "Stored" : "Pending"} detail={data.snapshot ? `${formatUsd18(data.snapshot.priceUsd18, 6)} · ${formatDate(data.snapshot.priceTimestamp)}` : "—"}/>
      <VerifyRow title="Private FCC policy" status={data.actionId ? "Signature accepted" : "Sealed"} detail={`Extension #${data.extensionId}`} tx={data.transactions.evaluation}/>
      <VerifyRow title="Event replay barrier" status={data.eventConsumed ? "Consumed" : "Available"} detail={compactAddress(data.eventHash, 10, 8)}/>
      <VerifyRow title="ProtectionVault" status={data.position ? "Position created" : "No position"} detail={compactAddress(contracts.protectionVault, 10, 8)} tx={data.transactions.execution}/>
      <VerifyRow title="Manager token residue" status={data.managerTokenBalance === 0n ? "Zero balance" : "Review required"} detail={`${data.managerTokenBalance.toString()} base units`}/>
      {data.tee && <VerifyRow title="FCC TEE registry" status={data.tee.status === 2 ? "PRODUCTION" : `Status ${data.tee.status}`} detail={`${compactAddress(data.tee.id)} · Extension #${data.tee.extensionId}`}/>}
    </div>
    <div className="privacy-note"><Icon name="lock"/><div><strong>Private by design</strong><p>Threshold, cooldown, maximum-per-event, expiry, and plaintext policy terms are not requested or rendered.</p></div></div>
  </aside></>;
}

function VerifyRow({ title, status, detail, tx }: { title: string; status: string; detail: string; tx?: `0x${string}` }) {
  return <div className="verify-row"><span className="verify-icon"><Icon name="check"/></span><div><strong>{title}</strong><p>{detail}</p></div><div className="verify-status"><span>{status}</span><ExplorerLink hash={tx}>Transaction</ExplorerLink></div></div>;
}
