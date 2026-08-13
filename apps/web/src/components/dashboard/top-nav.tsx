"use client";

import { WalletControl } from "./wallet-control";
import { Icon } from "./icons";
import Link from "next/link";
import { usePathname } from "next/navigation";

export function TopNav(props: { onVerify?: () => void } = {}) {
  void props.onVerify;
  const pathname = usePathname();
  const links = [{ href: "/dashboard", label: "Dashboard", active: pathname === "/dashboard", icon: "shield" }, { href: "/guards/new", label: "Create Guard", active: pathname === "/guards/new", icon: "lock" }, { href: "/guards", label: "Guards", active: pathname === "/guards", icon: "shield" }, { href: "/vaults", label: "Vaults", active: pathname === "/vaults", icon: "vault" }, { href: "/activity", label: "Activity", active: pathname === "/activity", icon: "pulse" }, { href: "/settings", label: "Settings", active: pathname === "/settings", icon: "wallet" }];
  return <><header className="top-nav">
    <Link className="wordmark" href="/" aria-label="AVERLOCK home"><span className="logo-mark"><Icon name="shield"/></span><span>AVERLOCK</span></Link>
    <nav aria-label="Primary navigation">
      {links.map((link) => <Link key={link.href} className={link.active ? "active" : ""} href={link.href} aria-current={link.active ? "page" : undefined}>{link.label}</Link>)}
    </nav>
    <div className="nav-actions"><span className="network-pill"><span/>Base Sepolia</span><WalletControl/></div>
  </header><nav className="mobile-primary-nav" aria-label="Mobile primary navigation">{links.map((link) => <Link key={link.href} className={link.active ? "active" : ""} href={link.href} aria-current={link.active ? "page" : undefined}><Icon name={link.icon}/><span>{link.label}</span></Link>)}</nav></>;
}
