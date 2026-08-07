"use client";

import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useAccount } from "wagmi";
import { coston2 } from "@/lib/averlock/config";
import { readDashboard } from "@/lib/averlock/reads";
import { mapProtectionGraph } from "@/lib/averlock/graph";
import { formatDate, formatUsd18 } from "@/lib/averlock/format";
import type { GraphNodeId } from "@/lib/averlock/types";
import { TopNav } from "./top-nav";
import { ProtectionGraph } from "./protection-graph";
import { NodeDetail } from "./node-detail";
import { VaultCard } from "./vault-card";
import { VerificationDrawer } from "./verification-drawer";
import { Icon } from "./icons";
import { WalletControl } from "./wallet-control";

export function Dashboard() {
  const { address, isConnected, chainId } = useAccount();
  const [selected, setSelected] = useState<GraphNodeId>("fcc");
  const [drawerOpen, setDrawerOpen] = useState(false);
  const query = useQuery({ queryKey: ["averlock-dashboard", address], queryFn: () => readDashboard(address!), enabled: Boolean(address && chainId === coston2.id), refetchInterval: 15_000 });
  const nodes = useMemo(() => query.data ? mapProtectionGraph(query.data) : [], [query.data]);
  const selectedNode = nodes.find((node) => node.id === selected) || nodes[0];
  return <div className="app-shell"><TopNav onVerify={() => setDrawerOpen(true)}/><main className="dashboard" id="overview">
    {!isConnected ? <StateScreen icon="shield" title="Connect to view your protection" description="AVERLOCK reads your guard, verified event, and vault position directly from Coston2. No dashboard values are simulated."><WalletControl/></StateScreen>
      : chainId !== coston2.id ? <StateScreen icon="pulse" title="Coston2 required" description="Switch networks to read the deployed AVERLOCK contracts and your onchain protection state."><WalletControl/></StateScreen>
      : query.isLoading ? <LoadingDashboard/>
      : query.isError ? <StateScreen icon="pulse" title="Coston2 read unavailable" description="The RPC did not return a complete protection state. No fallback data has been substituted."><button className="primary-button" onClick={() => query.refetch()}>Retry live reads</button></StateScreen>
      : !query.data ? <StateScreen icon="lock" title="No guard yet" description="This wallet has no guard registered with the current AVERLOCK GuardManager. Dashboard v1 is read-only; guard creation comes later."/>
      : <>
        <section className="hero" id="guards"><div className="hero-copy"><div className="status-line"><span><Icon name="shield"/></span><p>Onchain protection · Coston2</p></div><h1>Your protection is active.</h1><p>AVERLOCK follows your verified XRP payment from proof to private decision, then locks the protected value into a non-cancelable release schedule.</p><div className="hero-meta"><span><Icon name="check"/>Guard active</span><span><Icon name="lock"/>Policy sealed</span><span><Icon name="pulse"/>{query.data.eventConsumed ? "Execution consumed" : "Ready for execution"}</span></div></div><div className="hero-value"><p>Verified event value</p><strong>{query.data.snapshot ? formatUsd18(query.data.snapshot.eventValueUsd18, 2) : "Awaiting proof"}</strong><span>{query.data.snapshot ? `Snapshot ${formatDate(query.data.snapshot.preparedAt)}` : "No snapshot yet"}</span></div></section>
        <section className="flow-section"><div className="section-heading"><div><p className="eyebrow">Protection graph</p><h2>One verifiable protection path</h2></div><p>Explore each boundary. Drag to pan, scroll to zoom, or use arrow keys to move between nodes.</p></div><div className="graph-layout"><ProtectionGraph nodes={nodes} selected={selected} onSelect={setSelected}/>{selectedNode && <NodeDetail node={selectedNode} data={query.data}/>}</div></section>
        <div className="lower-grid"><VaultCard data={query.data}/><section className="activity-card" id="activity"><div className="section-heading"><div><p className="eyebrow">Latest activity</p><h2>Execution trail</h2></div><button onClick={() => setDrawerOpen(true)}>Open verification <Icon name="arrow"/></button></div><div className="activity-list">{[
          ["Guard registered", query.data.transactions.registration, query.data.guard.createdAt],
          ["FDC proof & FTSO snapshot", query.data.transactions.preparation, query.data.snapshot?.preparedAt],
          ["Private decision verified", query.data.transactions.evaluation, undefined],
          ["Vault position created", query.data.transactions.execution, query.data.position?.createdAt],
        ].filter(([, tx]) => tx).map(([label, tx, time]) => <div className="activity-row" key={label as string}><span><Icon name="check"/></span><div><strong>{label as string}</strong><p>{time ? formatDate(time as bigint) : "Verified on Coston2"}</p></div><a href={`${coston2.blockExplorers.default.url}/tx/${tx}`} target="_blank" rel="noreferrer" aria-label={`View ${label} transaction`}><Icon name="external"/></a></div>)}</div></section></div>
        <VerificationDrawer open={drawerOpen} onClose={() => setDrawerOpen(false)} data={query.data}/>
      </>}
  </main></div>;
}

function StateScreen({ icon, title, description, children }: { icon: string; title: string; description: string; children?: React.ReactNode }) { return <section className="state-screen"><span><Icon name={icon}/></span><h1>{title}</h1><p>{description}</p>{children}</section>; }
function LoadingDashboard() { return <div className="loading-dashboard"><div className="skeleton hero-skeleton"/><div className="skeleton graph-skeleton"/><div className="loading-label"><span/>Reading verified Coston2 state</div></div>; }
