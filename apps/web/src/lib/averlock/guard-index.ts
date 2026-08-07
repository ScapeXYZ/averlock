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
