import type { DashboardData, GraphNode } from "@/lib/averlock/types";
import { compactAddress, formatDate, formatToken, formatUsd18 } from "@/lib/averlock/format";

export function NodeDetail({ node, data }: { node: GraphNode; data: DashboardData }) {
  const rows: Array<[string, string]> = [];
  if (node.id === "payment") rows.push(["Event hash", compactAddress(data.eventHash, 10, 8)], ["Payment time", data.snapshot ? formatDate(data.snapshot.paymentTimestamp) : "Awaiting proof"]);
  if (node.id === "fdc") rows.push(["Verification", data.snapshot ? "XRPPayment accepted" : "Not prepared"], ["Preparation tx", compactAddress(data.transactions.preparation, 10, 8)]);
  if (node.id === "ftso") rows.push(["Snapshot price", data.snapshot ? formatUsd18(data.snapshot.priceUsd18, 6) : "—"], ["Price time", data.snapshot ? formatDate(data.snapshot.priceTimestamp) : "—"], ["Event value", data.snapshot ? formatUsd18(data.snapshot.eventValueUsd18, 3) : "—"]);
  if (node.id === "fcc") rows.push(["Policy", "Private policy verified"], ["Commitment", compactAddress(data.guard.policyCommitment, 10, 8)], ["Extension", `#${data.extensionId}`]);
  if (node.id === "decision") rows.push(["Outcome", data.actionId ? (data.decisionTriggered ? "Triggered" : "Not triggered") : "Awaiting decision"], ["Action", compactAddress(data.actionId, 10, 8)], ["Result consumed", data.resultConsumed ? "Yes" : "No"]);
  if (node.id === "vault") rows.push(["Position", data.position ? `#${data.position.id}` : "Not created"], ["Principal", data.position ? `${formatToken(data.position.totalDeposited)} FTestXRP` : "—"], ["Beneficiary", compactAddress(data.position?.beneficiary)]);
  return <aside className="node-detail" aria-live="polite"><div className="detail-state"><span/><span>{node.state}</span></div><p className="detail-kicker">{node.eyebrow}</p><h3>{node.title}</h3><p className="detail-description">{node.description}</p><dl>{rows.map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{value}</dd></div>)}</dl></aside>;
}
