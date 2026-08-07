import { describe, expect, it } from "vitest";
import { type Address, type Hex } from "viem";
import { activityContainsPrivateData, readWalletActivity, type ActivityGuardAnchor } from "./activity";
import { contracts } from "./config";
import type { GuardRecord, VaultPosition } from "./types";

const owner = "0x8E4f5D2736B988D4e922b988FF89bcCde45C6f2f" as Address;
const ruleId = `0x${"11".repeat(32)}` as Hex; const commitment = `0x${"22".repeat(32)}` as Hex; const receiver = `0x${"33".repeat(32)}` as Hex; const eventHash = `0x${"44".repeat(32)}` as Hex; const actionId = `0x${"55".repeat(32)}` as Hex; const tx = `0x${"66".repeat(32)}` as Hex;
const guard: GuardRecord = { owner, ruleId, policyCommitment: commitment, monitoredReceiverHash: receiver, scheduleId: 1, active: true, createdAt: 100n };
const position: VaultPosition = { id: 1n, asset: contracts.ftestXrp, beneficiary: owner, totalDeposited: 700_000_000n, claimed: 0n, startTimestamp: 200n, endTimestamp: 300n, createdAt: 200n };
const basic: ActivityGuardAnchor = { ruleId, registrationBlock: 10n }; const executed: ActivityGuardAnchor = { ...basic, executionBlock: 20n, eventHash, actionId, positionId: 1n };

function mock(options: { chain?: number; execute?: boolean; optionalFailure?: boolean; noGuard?: boolean } = {}) {
  const ranges: [bigint, bigint][] = [];
  return { ranges, client: {
    getChainId: async () => options.chain ?? 114,
    readContract: async ({ functionName }: { functionName: string }) => ({ protectionVault: contracts.protectionVault, getGuard: options.noGuard ? { ...guard, ruleId: `0x${"00".repeat(32)}` } : guard, getPosition: position } as Record<string, unknown>)[functionName],
    getBlock: async () => ({ timestamp: 250n }),
    getLogs: async ({ event, fromBlock, toBlock }: { event: { name: string }; fromBlock: bigint; toBlock: bigint }) => {
      ranges.push([fromBlock, toBlock]); if (options.optionalFailure && event.name === "GuardEvaluated") throw new Error("optional failure");
      if (event.name === "GuardRegistered") return [{ args: { owner, ruleId, policyCommitment: commitment }, transactionHash: tx }];
      if (!options.execute) return [];
      if (event.name === "GuardEvaluationPrepared") return [{ args: { paymentTimestamp: 150n, priceTimestamp: 190n }, transactionHash: tx }];
      if (event.name === "GuardEvaluated") return [{ args: { actionId, triggered: true }, transactionHash: tx }];
      if (event.name === "GuardTriggered") return [{ args: { vaultPositionId: 1n, fxrpAmountProtected: 700_000_000n }, transactionHash: tx }];
      if (event.name === "PositionCreated") return [{ args: { positionId: 1n, beneficiary: owner, amount: 700_000_000n, createdAt: 250n }, transactionHash: tx }];
      if (event.name === "Claimed") return [{ args: { positionId: 1n, beneficiary: owner, amount: 10n }, transactionHash: tx }]; return [];
    },
  }};
}

describe("receipt-bounded activity", () => {
  it("builds registration and sealed commitment activity", async () => { const { client } = mock(); const data = await readWalletActivity(owner, [basic], [], client as never); expect(data.items.map((x) => x.type)).toEqual(expect.arrayContaining(["guard-created", "policy-commitment"])); });
  it("builds executed guard and vault creation activity", async () => { const { client } = mock({ execute: true }); const data = await readWalletActivity(owner, [executed], [], client as never); expect(data.items.map((x) => x.type)).toEqual(expect.arrayContaining(["guard-triggered", "vault-created", "fcc-decision"])); });
  it("resolves a receipt-backed claim", async () => { const { client } = mock({ execute: true }); const data = await readWalletActivity(owner, [executed], [{ kind: "claim", owner, positionId: "1", transactionHash: tx, blockNumber: "30" }], client as never); expect(data.items.some((x) => x.type === "vault-claim")).toBe(true); });
  it("returns empty for an unbound wallet guard", async () => { const { client } = mock({ noGuard: true }); const data = await readWalletActivity(owner, [basic], [], client as never); expect(data.items).toHaveLength(0); });
  it("fails closed on wrong chain", async () => { const { client } = mock({ chain: 1 }); await expect(readWalletActivity(owner, [], [], client as never)).rejects.toThrow(/Wrong chain/); });
  it("never renders private policy fields", async () => { const { client } = mock({ execute: true }); const data = await readWalletActivity(owner, [executed], [], client as never); expect(activityContainsPrivateData(data.items)).toBe(false); const publicText = data.items.map((entry) => `${entry.title} ${entry.description}`).join(" ").toLowerCase(); expect(publicText).not.toMatch(/threshold|protectbps|maxperevent|cooldown|policyexpiry/); });
  it("isolates optional history failure", async () => { const { client } = mock({ execute: true, optionalFailure: true }); const data = await readWalletActivity(owner, [executed], [], client as never); expect(data.items.some((x) => x.type === "guard-created")).toBe(true); expect(data.warnings).toContain("FCC decision receipt unavailable"); });
  it("never requests an oversized log range", async () => { const { client, ranges } = mock({ execute: true }); await readWalletActivity(owner, [executed], [], client as never); expect(ranges.length).toBeGreaterThan(0); expect(ranges.every(([from, to]) => from === to)).toBe(true); });
});
