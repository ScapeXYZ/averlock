import type { Address, Hex } from "viem";

export type ClaimReceiptAnchor = { kind: "claim"; owner: Address; positionId: string; transactionHash: Hex; blockNumber: string };
const key = (owner: Address) => `averlock:activity:${owner.toLowerCase()}`;

export function loadClaimReceipts(owner: Address): ClaimReceiptAnchor[] {
  if (typeof window === "undefined") return [];
  try {
    const values = JSON.parse(localStorage.getItem(key(owner)) || "[]") as ClaimReceiptAnchor[];
    return values.filter((item) => item.kind === "claim" && item.owner.toLowerCase() === owner.toLowerCase() && /^0x[0-9a-fA-F]{64}$/.test(item.transactionHash));
  } catch { return []; }
}

export function saveClaimReceipt(item: ClaimReceiptAnchor) {
  const previous = loadClaimReceipts(item.owner).filter((entry) => entry.transactionHash !== item.transactionHash);
  localStorage.setItem(key(item.owner), JSON.stringify([item, ...previous]));
}

export function activityReceiptContainsPrivateData(item: ClaimReceiptAnchor) {
  const text = JSON.stringify(item).toLowerCase();
  return ["threshold", "protectbps", "maxperevent", "cooldown", "policyexpiry", "plaintext"].some((term) => text.includes(term));
}
