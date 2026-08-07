import { describe, expect, it } from "vitest";
import { keccak256, stringToHex, type Address, type Hex } from "viem";
import { contracts } from "./config";
import { isValidGuardRuleId, readGuardDetail } from "./guard-detail";
import type { EvaluationSnapshot, GuardRecord, VaultPosition } from "./types";

const ruleId = `0x${"11".repeat(32)}` as Hex;
const eventHash = `0x${"22".repeat(32)}` as Hex;
const actionId = `0x${"33".repeat(32)}` as Hex;
const commitment = `0x${"44".repeat(32)}` as Hex;
const receiverHash = `0x${"55".repeat(32)}` as Hex;
const owner = "0x8E4f5D2736B988D4e922b988FF89bcCde45C6f2f" as Address;
const tx = `0x${"66".repeat(32)}` as Hex;
const domain = keccak256(stringToHex("AVERLOCK_GUARD_RESULT_V2"));
const guard: GuardRecord = { owner, ruleId, policyCommitment: commitment, monitoredReceiverHash: receiverHash, scheduleId: 1, active: true, createdAt: 1_700_000_000n };
const snapshot: EvaluationSnapshot = { ruleId, eventValueUsd18: 1_000n, priceUsd18: 1n, priceTimestamp: 10n, paymentTimestamp: 5n, preparedAt: 11n };
const position: VaultPosition = { id: 1n, asset: contracts.ftestXrp, beneficiary: owner, totalDeposited: 700_000_000n, claimed: 0n, startTimestamp: 20n, endTimestamp: 30n, createdAt: 20n };

type Options = { guard?: GuardRecord; executed?: boolean; notTriggered?: boolean; registrationFailure?: boolean; registrationCommitment?: Hex; position?: VaultPosition };
function client(options: Options = {}) {
  const selectedGuard = options.guard || guard;
  return {
    getChainId: async () => 114,
    readContract: async ({ functionName }: { functionName: string }) => {
      const values: Record<string, unknown> = {
        getGuard: selectedGuard, protectionVault: contracts.protectionVault, paymentVerifier: contracts.paymentVerifier,
        priceReader: contracts.priceReader, fxrp: contracts.ftestXrp, extensionId: 65_927n, GUARD_RESULT_DOMAIN: domain,
        getEvaluationSnapshot: snapshot, isEventConsumed: Boolean(options.executed), isResultConsumed: Boolean(options.executed),
        getPosition: options.position || position, claimableAmount: 10n, remainingLockedAmount: 699_999_990n, isFullyVested: false,
      };
      return values[functionName];
    },
    getLogs: async ({ event }: { event: { name: string } }) => {
      if (event.name === "GuardRegistered") {
        if (options.registrationFailure) throw new Error("optional RPC unavailable");
        return [{ args: { owner, ruleId, policyCommitment: options.registrationCommitment || commitment, monitoredReceiverHash: receiverHash, scheduleId: 1 }, transactionHash: tx }];
      }
      if (event.name === "GuardEvaluated") return options.executed ? [{ args: { actionId, triggered: !options.notTriggered }, transactionHash: tx }] : [];
      if (event.name === "GuardTriggered") return options.executed && !options.notTriggered ? [{ args: { vaultPositionId: 1n }, transactionHash: tx }] : [];
      return [];
    },
  };
}

const executedAnchor = { owner, registrationBlock: 1n, eventHash, actionId, executionBlock: 2n };

describe("Guard detail reads", () => {
  it("rejects invalid rule IDs before an RPC read", () => expect(isValidGuardRuleId("0x1234")).toBe(false));
  it("returns a registered but not-triggered waiting state", async () => {
    const data = await readGuardDetail(ruleId, { owner }, client() as never);
    expect(data.status).toBe("active"); expect(data.position).toBeUndefined(); expect(data.lifecycle.every((stage) => stage.state === "waiting")).toBe(true);
  });
  it("returns a complete executed guard and vault position", async () => {
    const data = await readGuardDetail(ruleId, executedAnchor, client({ executed: true }) as never);
    expect(data.status).toBe("executed"); expect(data.position?.totalDeposited).toBe(700_000_000n); expect(data.eventConsumed).toBe(true); expect(data.resultConsumed).toBe(true);
  });
  it("treats a consumed false FCC decision as completed without inventing a vault position", async () => {
    const data = await readGuardDetail(ruleId, executedAnchor, client({ executed: true, notTriggered: true }) as never);
    expect(data.status).toBe("executed"); expect(data.decisionTriggered).toBe(false); expect(data.position).toBeUndefined();
    expect(data.lifecycle.at(-1)).toMatchObject({ state: "verified", detail: "No position required by the FCC decision" });
  });
  it("fails closed on commitment mismatch", async () => {
    await expect(readGuardDetail(ruleId, { owner, registrationBlock: 1n }, client({ registrationCommitment: `0x${"99".repeat(32)}` as Hex }) as never)).rejects.toThrow(/binding mismatch/);
  });
  it("fails closed on wrong owner", async () => {
    await expect(readGuardDetail(ruleId, { owner: "0x0000000000000000000000000000000000000001" }, client() as never)).rejects.toThrow(/owner binding mismatch/);
  });
  it("isolates optional receipt RPC failure", async () => {
    const data = await readGuardDetail(ruleId, { owner, registrationBlock: 1n }, client({ registrationFailure: true }) as never);
    expect(data.guard.ruleId).toBe(ruleId); expect(data.optionalErrors).toContain("Registration receipt evidence unavailable");
  });
  it("fails closed on vault beneficiary mismatch", async () => {
    const wrong = { ...position, beneficiary: "0x0000000000000000000000000000000000000001" as Address };
    await expect(readGuardDetail(ruleId, executedAnchor, client({ executed: true, position: wrong }) as never)).rejects.toThrow(/beneficiary or asset binding mismatch/);
  });
});
