import type { Address, Hex } from "viem";

export type GuardIndexEntry = {
  ruleId: Hex;
  registrationBlock: string;
  transactionHash: Hex;
  owner: Address;
  eventHash?: Hex;
  fdcRequestTransaction?: Hex;
  preparationTransaction?: Hex;
  fccTransaction?: Hex;
  actionId?: Hex;
  executionTransaction?: Hex;
  executionBlock?: string;
  positionId?: string;
};
const key = (owner: Address) => `averlock:guards:${owner.toLowerCase()}`;

type IndexerEvent = { transaction_hash: Hex; block_number: string; payload: { ruleId: Hex } };

/**
 * Product history comes from the small AVERLOCK-only indexer when configured. The
 * browser cache is retained solely as a receipt hand-off while that service catches
 * up; it is never treated as contract state or as a fabricated history source.
 */
export async function fetchGuardIndex(owner: Address): Promise<GuardIndexEntry[]> {
  const base = process.env.NEXT_PUBLIC_AVERLOCK_INDEXER_URL;
  if (!base) return loadGuardIndex(owner);
  const response = await fetch(`${base.replace(/\/$/, "")}/guards?owner=${owner}`, { cache: "no-store" });
  if (!response.ok) throw new Error("AVERLOCK activity indexer is unavailable.");
  const body = await response.json() as { items?: IndexerEvent[] };
  const remote = (body.items || []).map((event) => ({
    ruleId: event.payload.ruleId, registrationBlock: event.block_number,
    transactionHash: event.transaction_hash, owner,
  } satisfies GuardIndexEntry));
  // A just-confirmed guard can be used immediately even if the optional history
  // indexer is behind. Contract reads remain authoritative in either case.
  const cached = loadGuardIndex(owner);
  return [...new Map([...cached, ...remote].map((entry) => [entry.ruleId.toLowerCase(), entry])).values()];
}

export function loadGuardIndex(owner: Address): GuardIndexEntry[] {
  if (typeof window === "undefined") return [];
  try {
    const value = JSON.parse(localStorage.getItem(key(owner)) || "[]") as GuardIndexEntry[];
    return value.filter((entry) => entry.owner.toLowerCase() === owner.toLowerCase() && /^0x[0-9a-fA-F]{64}$/.test(entry.ruleId));
  } catch { return []; }
}

export function saveGuardIndex(entry: GuardIndexEntry) {
  const existing = loadGuardIndex(entry.owner).filter((item) => item.ruleId.toLowerCase() !== entry.ruleId.toLowerCase());
  // Only public receipt-backed identifiers are stored. Private form values are never persisted.
  localStorage.setItem(key(entry.owner), JSON.stringify([entry, ...existing]));
}

export function updateGuardIndex(owner: Address, ruleId: Hex, patch: Partial<Omit<GuardIndexEntry, "owner" | "ruleId">>) {
  const current = loadGuardIndex(owner).find((entry) => entry.ruleId.toLowerCase() === ruleId.toLowerCase());
  if (!current) throw new Error("Receipt-backed guard registration index is missing.");
  saveGuardIndex({ ...current, ...patch, owner, ruleId });
}

export function guardIndexContainsPrivateData(entry: GuardIndexEntry) {
  const text = JSON.stringify(entry);
  return ["threshold", "protect", "maximum", "cooldown", "expires"].some((term) => text.toLowerCase().includes(term));
}
