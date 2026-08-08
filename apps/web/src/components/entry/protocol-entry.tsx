"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { Dashboard } from "@/components/dashboard/dashboard";
import { Icon } from "@/components/dashboard/icons";

const ENTRY_KEY = "averlock-protocol-entry-seen";

const stages = [
  { label: "Define Protection", detail: "Rules sealed", icon: "shield" },
  { label: "Lock Value", detail: "On-chain vault", icon: "lock" },
  { label: "Flare Verifies", detail: "Verifiable condition", icon: "proof" },
  { label: "Automatic Execution", detail: "Protection enforced", icon: "check" },
];

export function ProtocolEntry() {
  const [ready, setReady] = useState(false);
  const [entered, setEntered] = useState(false);

  useEffect(() => {
    setEntered(window.localStorage.getItem(ENTRY_KEY) === "true");
    setReady(true);
  }, []);

  const enterApplication = () => {
    window.localStorage.setItem(ENTRY_KEY, "true");
    setEntered(true);
  };

  if (!ready) return <main className="protocol-entry" aria-busy="true" />;
  if (entered) return <Dashboard />;

  return <main className="protocol-entry">
    <nav className="protocol-entry-nav" aria-label="AVERLOCK entry">
      <div className="wordmark"><span className="logo-mark"><Icon name="shield" /></span><span>AVERLOCK</span></div>
      <span className="entry-network"><i />Coston2 · Flare</span>
    </nav>
    <section className="protocol-entry-hero">
      <div className="entry-copy">
        <p className="entry-eyebrow"><span />Programmable on-chain protection</p>
        <h1>Protection that<br />proves itself.</h1>
        <p className="entry-intro">Create protection with defined rules. Value is locked on-chain and execution follows only after verifiable conditions are satisfied.</p>
        <div className="entry-actions">
          <button className="entry-primary" onClick={enterApplication}>Enter AVERLOCK <Icon name="arrow" /></button>
          <Link className="entry-secondary" href="/verify">Verify Protection <Icon name="proof" /></Link>
        </div>
      </div>
      <div className="entry-architecture" aria-label="AVERLOCK protection lifecycle">
        <div className="architecture-header"><span>Protection lifecycle</span><small><i />Verification path active</small></div>
        <div className="architecture-orbit orbit-one" /><div className="architecture-orbit orbit-two" />
        <div className="architecture-core"><Icon name="shield" /><span>AVERLOCK</span></div>
        <div className="architecture-flow">
          {stages.map((stage, index) => <div className="architecture-stage-wrap" key={stage.label}>
            <article className={`architecture-stage stage-${index + 1}`}>
              <span className="architecture-index">0{index + 1}</span><span className="architecture-icon"><Icon name={stage.icon} /></span>
              <div><strong>{stage.label}</strong><small>{stage.detail}</small></div>
            </article>
            {index < stages.length - 1 && <span className="architecture-link" aria-hidden="true"><b /></span>}
          </div>)}
        </div>
        <div className="architecture-foot"><span><i />Coston2 settlement</span><span>Flare verification</span></div>
      </div>
    </section>
    <footer className="protocol-entry-footer"><span>Rules remain yours. Execution remains verifiable.</span><span>On-chain protection · Coston2</span></footer>
  </main>;
}
