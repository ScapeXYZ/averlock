import type { DashboardData } from "@/lib/averlock/types";
import { formatDate, formatToken, relativeUnlock } from "@/lib/averlock/format";
import { Icon } from "./icons";

export function VaultCard({ data }: { data: DashboardData }) {
  const position = data.position;
  return <section className="vault-card" id="vaults"><div className="section-heading"><div><p className="eyebrow">ProtectionVault</p><h2>Protected position</h2></div>{position && <span className="verified-chip"><Icon name="check"/>Onchain</span>}</div>
    {!position ? <div className="empty-card"><span className="empty-icon"><Icon name="vault"/></span><h3>No vault position yet</h3><p>The verified flow is visible above. A position will appear here after a triggered decision is executed.</p></div> : <>
      <div className="vault-amount"><span>Protected principal</span><strong>{formatToken(position.totalDeposited)} <small>FTestXRP</small></strong><p>Position #{position.id.toString()} · Non-cancelable</p></div>
      <div className="release-track"><div className="release-progress" style={{ width: `${Math.min(100, Math.max(0, Number((position.claimed + data.claimable) * 100n / position.totalDeposited)))}%` }}/></div>
      <div className="vault-stats"><div><span>Status</span><strong>{data.fullyVested ? "Released" : "Linear release"}</strong></div><div><span>Claimable now</span><strong>{formatToken(data.claimable)}</strong></div><div><span>Still locked</span><strong>{formatToken(data.remainingLocked)}</strong></div></div>
      <div className="vault-footer"><span><Icon name="lock"/>{relativeUnlock(position.endTimestamp)}</span><span>{formatDate(position.startTimestamp)} → {formatDate(position.endTimestamp)}</span></div>
    </>}
  </section>;
}
