"use client";

import { WalletControl } from "./wallet-control";
import { Icon } from "./icons";
import Link from "next/link";
import { usePathname } from "next/navigation";

export function TopNav({ onVerify }: { onVerify?: () => void }) {
  const pathname = usePathname();
  const links = [{ href: "/", label: "Overview", active: pathname === "/", icon: "shield" }, { href: "/guards", label: "Guards", active: pathname.startsWith("/guards"), icon: "lock" }, { href: "/vaults", label: "Vaults", active: pathname === "/vaults", icon: "vault" }, { href: "/activity", label: "Activity", active: pathname === "/activity", icon: "pulse" }, { href: "/verify", label: "Verify", active: pathname === "/verify", icon: "proof" }];
  return <><header className="top-nav">
    <Link className="wordmark" href="/" aria-label="AVERLOCK home"><span className="logo-mark"><Icon name="shield"/></span><span>AVERLOCK</span></Link>
    <nav aria-label="Primary navigation">
      {links.map((link) => <Link key={link.href} className={link.active ? "active" : ""} href={link.href} aria-current={link.active ? "page" : undefined} onClick={link.href === "/verify" ? (event) => { if (onVerify) { event.preventDefault(); onVerify(); } } : undefined}>{link.label}</Link>)}
    </nav>
    <div className="nav-actions"><span className="network-pill"><span/>Coston2</span><WalletControl/></div>
  </header><nav className="mobile-primary-nav" aria-label="Mobile primary navigation">{links.map((link) => <Link key={link.href} className={link.active ? "active" : ""} href={link.href} aria-current={link.active ? "page" : undefined}><Icon name={link.icon}/><span>{link.label}</span></Link>)}</nav></>;
}
