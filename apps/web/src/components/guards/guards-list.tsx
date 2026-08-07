"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { getAddress, type Hex } from "viem";
import { useAccount } from "wagmi";
import { compactAddress } from "@/lib/averlock/format";
import { loadGuardIndex } from "@/lib/averlock/guard-index";
import { readGuard } from "@/lib/averlock/reads";
import type { GuardRecord } from "@/lib/averlock/types";
import { Icon } from "@/components/dashboard/icons";
import { devError, userFacingError } from "@/lib/averlock/errors";

type ListedGuard = { ruleId: Hex; transactionHash: Hex; guard: GuardRecord };

export function GuardsList() {
  const { address, isConnected } = useAccount();
  const [guards, setGuards] = useState<ListedGuard[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => {
    let cancelled = false;
    if (!address) return;
    Promise.resolve().then(() => { if (!cancelled) { setLoading(true); setError(""); } });
    Promise.all(loadGuardIndex(address).map(async (entry) => ({ ...entry, guard: await readGuard(entry.ruleId) })))
      .then((items) => { if (!cancelled) setGuards(items.filter((item) => getAddress(item.guard.owner) === getAddress(address))); })
      .catch((cause) => { devError("guard list", cause); if (!cancelled) setError(userFacingError(cause, "Registered guards could not be loaded safely.")); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [address]);

  if (!isConnected) return <Empty title="Connect your Coston2 wallet" body="AVERLOCK reads guards owned by the connected wallet. No private policy values are requested."/>;
  if (loading) return <Empty title="Reading registered guards" body="Checking receipt-backed guard IDs against the live Coston2 GuardManager."/>;
  if (error) return <Empty title="Guard reads unavailable" body={error}/>;
  if (!guards.length) return <Empty title="No guards registered from this browser" body="Guard discovery uses locally recorded public registration receipts, avoiding unsafe wide Coston2 log scans."/>;
  return <div className="guard-list">{guards.map(({ guard, ruleId, transactionHash }) => <Link href={`/guards/${ruleId}`} className="guard-list-card" key={ruleId}><span className="guard-card-icon"><Icon name="shield"/></span><div><p>Private payment guard</p><h2>{compactAddress(ruleId, 12, 10)}</h2><small>Commitment {compactAddress(guard.policyCommitment, 10, 8)}</small></div><div className="guard-list-meta"><strong>{guard.active ? "Active" : "Inactive"}</strong><span>Schedule {guard.scheduleId}</span><span>Tx {compactAddress(transactionHash, 8, 6)}</span></div></Link>)}</div>;
}

function Empty({ title, body }: { title: string; body: string }) { return <div className="guards-empty"><span><Icon name="shield"/></span><h2>{title}</h2><p>{body}</p><Link className="primary-button" href="/guards/new">Create Guard</Link></div>; }
