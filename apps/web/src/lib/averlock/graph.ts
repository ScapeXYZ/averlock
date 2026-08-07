import { formatToken, formatUsd18, formatXrpFromSnapshot } from "./format";
import type { DashboardData, GraphNode } from "./types";

export function mapProtectionGraph(data: DashboardData): GraphNode[] {
  const prepared = Boolean(data.snapshot && data.eventHash);
  const evaluated = Boolean(data.actionId);
  const protectedPosition = Boolean(data.position);
  return [
    { id: "payment", eyebrow: "Source event", title: "XRPL Payment", description: "The external XRP payment bound into this protection event.", state: prepared ? "verified" : "pending", metric: data.snapshot ? formatXrpFromSnapshot(data.snapshot.eventValueUsd18, data.snapshot.priceUsd18) : undefined },
    { id: "fdc", eyebrow: "Flare Data Connector", title: "FDC Payment Proof", description: "The stored snapshot can only exist after the official XRPPayment proof succeeds.", state: prepared ? "verified" : "pending", metric: prepared ? "Proof accepted" : undefined },
    { id: "ftso", eyebrow: "Price snapshot", title: "FTSO XRP/USD Snapshot", description: "One immutable onchain valuation is shared by FCC and execution.", state: prepared ? "verified" : "pending", metric: data.snapshot ? formatUsd18(data.snapshot.priceUsd18, 6) : undefined },
    { id: "fcc", eyebrow: "Confidential compute", title: "Private FCC Guard", description: "Private terms stay sealed while the signed decision remains publicly verifiable.", state: evaluated ? "verified" : prepared ? "active" : "pending", metric: "Private policy verified" },
    { id: "decision", eyebrow: "Signed authorization", title: "Protection Decision", description: "The V2 result binds the rule, event, value, nonce, and short execution window.", state: evaluated ? "verified" : prepared ? "active" : "pending", metric: evaluated ? (data.decisionTriggered ? "Protection triggered" : "No trigger") : undefined },
    { id: "vault", eyebrow: "Non-cancelable release", title: "ProtectionVault", description: "Protected FTestXRP releases linearly to the beneficiary over the verified schedule.", state: protectedPosition ? "verified" : evaluated ? "active" : "pending", metric: data.position ? `${formatToken(data.position.totalDeposited)} FTestXRP` : undefined },
  ];
}
