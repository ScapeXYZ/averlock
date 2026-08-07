import { describe, expect, it } from "vitest";
import type { Address, Hex } from "viem";
import { contracts } from "./config";
import { canClaimPosition, readWalletVaults, type VaultAnchor, type VaultView } from "./vaults";
import type { GuardRecord, VaultPosition } from "./types";

const owner = "0x8E4f5D2736B988D4e922b988FF89bcCde45C6f2f" as Address;
const ruleId = `0x${"11".repeat(32)}` as Hex; const eventHash = `0x${"22".repeat(32)}` as Hex; const tx = `0x${"33".repeat(32)}` as Hex;
const anchor: VaultAnchor = { positionId: 1n, ruleId, eventHash, executionBlock: 9n };
const position: VaultPosition = { id: 1n, asset: contracts.ftestXrp, beneficiary: owner, totalDeposited: 700_000_000n, claimed: 0n, startTimestamp: 100n, endTimestamp: 200n, createdAt: 100n };
const guard: GuardRecord = { owner, ruleId, policyCommitment: `0x${"44".repeat(32)}`, monitoredReceiverHash: `0x${"55".repeat(32)}`, scheduleId: 1, active: true, createdAt: 90n };

function client({ chain = 114, count = 1n, claimable = 100n, locked = 600n, vested = false, beneficiary = owner, optionalFailure = false } = {}) {
  return {
    getChainId: async () => chain,
    readContract: async ({ functionName }: { functionName: string }) => {
      if (optionalFailure && ["claimableAmount", "remainingLockedAmount", "isFullyVested"].includes(functionName)) throw new Error("optional RPC failure");
      const values: Record<string, unknown> = { positionCount: count, protectionVault: contracts.protectionVault, getPosition: { ...position, beneficiary }, getGuard: guard, claimableAmount: claimable, remainingLockedAmount: locked, isFullyVested: vested };
      return values[functionName];
    },
    getLogs: async () => [{ args: { vaultPositionId: 1n }, transactionHash: tx }],
  };
}

describe("ProtectionVault wallet reads", () => {
  it("reads an existing partially vested position", async () => { const data = await readWalletVaults(owner, [anchor], client() as never); expect(data.positions[0].status).toBe("releasing"); expect(data.totalClaimable).toBe(100n); });
  it("returns an empty wallet vault without enumerating positions", async () => { const data = await readWalletVaults(owner, [anchor], client({ count: 0n }) as never); expect(data.positions).toEqual([]); expect(data.positionCount).toBe(0n); });
  it("identifies a fully vested position", async () => { const data = await readWalletVaults(owner, [anchor], client({ claimable: 700n, locked: 0n, vested: true }) as never); expect(data.positions[0].status).toBe("fully-vested"); });
  it("fails closed on beneficiary/origin guard mismatch", async () => { await expect(readWalletVaults(owner, [anchor], client({ beneficiary: "0x0000000000000000000000000000000000000001" }) as never)).rejects.toThrow(/beneficiary mismatch/); });
  it("fails closed on the wrong chain", async () => { await expect(readWalletVaults(owner, [anchor], client({ chain: 1 }) as never)).rejects.toThrow(/Wrong chain/); });
  it("isolates optional vesting RPC failures", async () => { const data = await readWalletVaults(owner, [anchor], client({ optionalFailure: true }) as never); expect(data.positions).toHaveLength(1); expect(data.positions[0].claimable).toBeUndefined(); expect(data.positions[0].optionalErrors).toHaveLength(3); });
  it("allows claims only for a positive amount, beneficiary, and Coston2", () => { const item = { position, claimable: 1n } as VaultView; expect(canClaimPosition(item, owner, 114)).toBe(true); expect(canClaimPosition({ ...item, claimable: 0n }, owner, 114)).toBe(false); expect(canClaimPosition(item, owner, 1)).toBe(false); });
});
