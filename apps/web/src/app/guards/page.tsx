import Link from "next/link";
import { TopNav } from "@/components/dashboard/top-nav";
import { GuardsList } from "@/components/guards/guards-list";

export default function GuardsPage() { return <div className="app-shell"><TopNav/><main className="guards-page"><header className="guards-heading"><div><p className="eyebrow">Protection guards</p><h1>Your guards</h1><p>Public guard bindings from the live Coston2 GuardManager. Confidential policy terms remain sealed.</p></div><Link className="primary-button" href="/guards/new">Create Guard</Link></header><GuardsList/></main></div>; }
