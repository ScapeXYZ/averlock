import Link from "next/link";
import { Icon } from "@/components/dashboard/icons";
export function BaseLanding() {
  return (
    <main className="base-landing">
      <nav>
        <Link className="wordmark" href="/">
          <span className="logo-mark">
            <Icon name="shield" />
          </span>
          <span>AVERLOCK</span>
        </Link>
        <span className="base-chip">Base Sepolia</span>
      </nav>
      <section className="landing-hero">
        <div>
          <p className="landing-kicker">Protection rules for Base</p>
          <h1>
            Protect your gains.
            <br />
            Enforce your discipline.
          </h1>
          <p>
            AVERLOCK turns a plan into transparent smart-contract rules. Commit
            approved funds, let the rule enforce the cooldown, and release value
            on the schedule you chose.
          </p>
          <div className="landing-actions">
            <Link className="primary-button" href="/dashboard">
              Launch AVERLOCK <Icon name="arrow" />
            </Link>
            <a className="entry-secondary" href="#how">
              See how it works
            </a>
          </div>
          <small>
            No fake balances. No hidden execution. Contract state is the source
            of truth.
          </small>
        </div>
        <aside className="canva-slot" aria-label="AVERLOCK contract flow">
          <span>Public on-chain protection</span>
          <strong>Guard → Vault</strong>
          <p>USDC protection on Base Sepolia. ETH is used only for gas.</p>
          <div>
            <b>84532</b>
            <small>Base Sepolia</small>
          </div>
        </aside>
      </section>
      <section id="how" className="landing-steps">
        {[
          [
            "shield",
            "Create a rule",
            "Choose an approved asset, amount, cooldown, and release schedule.",
          ],
          [
            "lock",
            "Protect funds",
            "Approve the exact amount and arm the guard in a separate transaction.",
          ],
          [
            "vault",
            "Enter the vault",
            "Once eligible, execution creates a real non-cancelable vault position.",
          ],
          [
            "wallet",
            "Release by schedule",
            "Claim only what the contract says has vested.",
          ],
        ].map((x, i) => (
          <article key={x[1]}>
            <b>0{i + 1}</b>
            <Icon name={x[0]} />
            <h2>{x[1]}</h2>
            <p>{x[2]}</p>
          </article>
        ))}
      </section>
      <section className="diagram-slot">
        <div>
          <p className="eyebrow">Contract lifecycle</p>
          <h2>Guard → Trigger → Vault → Release</h2>
          <p>
            Contract reads are authoritative. The optional event indexer supplies
            discovery and history without controlling current state.
          </p>
        </div>
        <span>USDC protection · ETH gas · BaseScan receipts</span>
      </section>
      <footer>
        <span>AVERLOCK</span>
        <p>
          Currently configured for Base Sepolia. Mainnet execution is not
          enabled.
        </p>
      </footer>
    </main>
  );
}
