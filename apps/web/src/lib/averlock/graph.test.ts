import { describe, expect, it } from "vitest";
import { mapProtectionGraph } from "./graph";
import type { DashboardData } from "./types";

const fixture = (overrides: Partial<DashboardData> = {}): DashboardData => ({
  guard: { owner: "0x0000000000000000000000000000000000000001", ruleId: `0x${"01".repeat(32)}`, policyCommitment: `0x${"02".repeat(32)}`, monitoredReceiverHash: `0x${"03".repeat(32)}`, scheduleId: 1, active: true, createdAt: 1n },
  snapshot: { ruleId: `0x${"01".repeat(32)}`, eventValueUsd18: 1_056_936n * 10n ** 15n, priceUsd18: 1_056_936n * 10n ** 12n, priceTimestamp: 2n, paymentTimestamp: 1n, preparedAt: 3n },
  eventHash: `0x${"04".repeat(32)}`, eventConsumed: false, resultConsumed: false,
  positionCount: 0n, claimable: 0n, remainingLocked: 0n, fullyVested: false, managerTokenBalance: 0n,
  livePriceUsd18: 1n, livePriceTimestamp: 1n, extensionId: 65_927n, resultDomain: `0x${"05".repeat(32)}`,
  transactions: {}, ...overrides,
});

describe("mapProtectionGraph", () => {
  it("marks proof and price nodes verified from a stored snapshot", () => {
    const nodes = mapProtectionGraph(fixture());
    expect(nodes.find((node) => node.id === "fdc")?.state).toBe("verified");
    expect(nodes.find((node) => node.id === "ftso")?.metric).toContain("$1.056936");
  });

  it("never renders private policy terms", () => {
    const serialized = JSON.stringify(mapProtectionGraph(fixture()));
    expect(serialized).toContain("Private policy verified");
    expect(serialized).not.toContain("threshold");
    expect(serialized).not.toContain("cooldown");
  });

  it("shows a verified vault only after a real position is present", () => {
    const pending = mapProtectionGraph(fixture()).at(-1);
    const protectedGraph = mapProtectionGraph(fixture({ position: { id: 1n, asset: "0x0000000000000000000000000000000000000002", beneficiary: "0x0000000000000000000000000000000000000001", totalDeposited: 700_000_000n, claimed: 0n, startTimestamp: 1n, endTimestamp: 2n, createdAt: 1n } }));
    expect(pending?.state).toBe("pending");
    expect(protectedGraph.at(-1)?.state).toBe("verified");
    expect(protectedGraph.at(-1)?.metric).toBe("700 FTestXRP");
  });
});
