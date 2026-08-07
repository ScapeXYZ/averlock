import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Address, Hex } from "viem";

const owner = "0x8E4f5D2736B988D4e922b988FF89bcCde45C6f2f" as Address;
const ruleId = "0x2a3a9591def2b67120f829c342d002de5e2def49ac0f4044a6be143071489400" as Hex;

const state = vi.hoisted(() => ({ readContract: vi.fn(), getLogs: vi.fn() }));
vi.mock("./config", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./config")>();
  return { ...actual, publicClient: { getChainId: async () => 114, readContract: state.readContract, getLogs: state.getLogs } };
});

import { contracts } from "./config";
import { dashboardReadDiagnostics, readDashboard } from "./reads";

const guard = { owner, ruleId, policyCommitment: `0x${"11".repeat(32)}`, monitoredReceiverHash: `0x${"22".repeat(32)}`, scheduleId: 1, active: true, createdAt: 100n };
const snapshot = { ruleId, eventValueUsd18: 1n, priceUsd18: 1n, priceTimestamp: 100n, paymentTimestamp: 99n, preparedAt: 100n };
const position = { id: 1n, asset: contracts.ftestXrp, beneficiary: owner, totalDeposited: 700_000_000n, claimed: 0n, startTimestamp: 100n, endTimestamp: 200n, createdAt: 100n };

function arrange({ triggered, positionCount = triggered ? 1n : 0n, malformedRequired = false }: { triggered: boolean; positionCount?: bigint; malformedRequired?: boolean }) {
  state.readContract.mockImplementation(async ({ functionName }: { functionName: string }) => {
    if (malformedRequired && functionName === "getEvaluationSnapshot") throw new Error("EvaluationNotPrepared");
    const values: Record<string, unknown> = { getGuard: guard, getEvaluationSnapshot: snapshot, isEventConsumed: true, isResultConsumed: true, balanceOf: 0n, extensionId: 65_927n, GUARD_RESULT_DOMAIN: `0x${"33".repeat(32)}`, positionCount, getPosition: position, claimableAmount: 1n, remainingLockedAmount: 699_999_999n, isFullyVested: false, getXrpUsdPriceUsd18: [1n, 100n] };
    return values[functionName];
  });
  state.getLogs.mockImplementation(async ({ event }: { event: { name: string } }) => event.name === "GuardEvaluated" ? [{ args: { triggered }, transactionHash: `0x${"44".repeat(32)}` }] : []);
}

describe("dashboard reads", () => {
  beforeEach(() => {
    state.readContract.mockReset();
    state.getLogs.mockReset();
  });

  it("returns a completed triggered decision with its vault position", async () => {
    arrange({ triggered: true });
    const data = await readDashboard(owner);
    expect(data?.decisionTriggered).toBe(true);
    expect(data?.position).toEqual(position);
  });

  it("returns a completed non-triggered decision without reading a vault position", async () => {
    arrange({ triggered: false });
    const data = await readDashboard(owner);
    expect(data?.decisionTriggered).toBe(false);
    expect(data?.position).toBeUndefined();
    expect(state.readContract.mock.calls.some(([request]) => request.functionName === "getPosition")).toBe(false);
  });

  it("fails closed when the required event snapshot is malformed or absent", async () => {
    arrange({ triggered: false, malformedRequired: true });
    await expect(readDashboard(owner)).rejects.toThrow("EvaluationNotPrepared");
  });

  it("isolates an optional RPC failure instead of rejecting core state", async () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);
    await expect(dashboardReadDiagnostics.optional("optional feed", async () => { throw new Error("RPC unavailable"); })).resolves.toBeUndefined();
    expect(consoleError).toHaveBeenCalledOnce();
    consoleError.mockRestore();
  });
});
