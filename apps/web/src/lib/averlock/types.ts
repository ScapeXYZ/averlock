import type { Address, Hex } from "viem";

export type GuardRecord = { owner: Address; ruleId: Hex; policyCommitment: Hex; monitoredReceiverHash: Hex; scheduleId: number; active: boolean; createdAt: bigint };
export type EvaluationSnapshot = { ruleId: Hex; eventValueUsd18: bigint; priceUsd18: bigint; priceTimestamp: bigint; paymentTimestamp: bigint; preparedAt: bigint };
export type VaultPosition = { id: bigint; asset: Address; beneficiary: Address; totalDeposited: bigint; claimed: bigint; startTimestamp: bigint; endTimestamp: bigint; createdAt: bigint };

export type DashboardData = {
  guard: GuardRecord;
  snapshot?: EvaluationSnapshot;
  eventHash?: Hex;
  eventConsumed: boolean;
  actionId?: Hex;
  decisionTriggered?: boolean;
  resultConsumed: boolean;
  position?: VaultPosition;
  positionCount: bigint;
  claimable: bigint;
  remainingLocked: bigint;
  fullyVested: boolean;
  managerTokenBalance: bigint;
  livePriceUsd18?: bigint;
  livePriceTimestamp?: bigint;
  extensionId: bigint;
  resultDomain: Hex;
  tee?: { id: Address; proxy: Address; url: string; status: number; extensionId: bigint };
  transactions: { registration?: Hex; preparation?: Hex; evaluation?: Hex; execution?: Hex };
};

export type DashboardState = "verified" | "active" | "pending" | "unavailable";
export type GraphNodeId = "payment" | "fdc" | "ftso" | "fcc" | "decision" | "vault";
export type GraphNode = { id: GraphNodeId; eyebrow: string; title: string; description: string; state: DashboardState; metric?: string };

export type GuardDetailAnchor = {
  owner?: Address;
  registrationBlock?: bigint;
  registrationTransaction?: Hex;
  eventHash?: Hex;
  actionId?: Hex;
  executionBlock?: bigint;
  executionTransaction?: Hex;
};

export type GuardLifecycleStage = { id: "payment" | "fdc" | "ftso" | "fcc" | "execution" | "vault"; label: string; state: "waiting" | "verified" | "executed" | "unavailable"; detail: string };

export type GuardDetailData = {
  guard: GuardRecord;
  status: "active" | "expired" | "executed";
  registrationTransaction?: Hex;
  registrationBlock?: bigint;
  snapshot?: EvaluationSnapshot;
  eventHash?: Hex;
  eventConsumed?: boolean;
  actionId?: Hex;
  resultConsumed?: boolean;
  decisionTriggered?: boolean;
  executionTransaction?: Hex;
  position?: VaultPosition;
  claimable?: bigint;
  remainingLocked?: bigint;
  fullyVested?: boolean;
  extensionId: bigint;
  resultDomain: Hex;
  lifecycle: GuardLifecycleStage[];
  optionalErrors: string[];
};
