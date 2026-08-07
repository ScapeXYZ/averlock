import { getAddress, type Address } from "viem";
import { contracts, dashboardSelection, publicClient } from "./config";
import { erc20Abi, guardEvaluatedEvent, guardManagerAbi, guardPreparedEvent, guardRegisteredEvent, guardTriggeredEvent, priceReaderAbi, teeManagerAbi, vaultAbi } from "./contracts";
import type { DashboardData, EvaluationSnapshot, GuardRecord, VaultPosition } from "./types";

const devDiagnostic = (label: string, error: unknown) => {
  if (process.env.NODE_ENV !== "production") console.error(`[AVERLOCK read] ${label} unavailable`, error);
};

async function optional<T>(label: string, read: () => Promise<T>): Promise<T | undefined> {
  try { return await read(); } catch (error) { devDiagnostic(label, error); return undefined; }
}

const last = <T,>(items?: readonly T[]) => items?.length ? items[items.length - 1] : undefined;

export async function readDashboard(owner: Address): Promise<DashboardData | null> {
  const { ruleId, eventHash, actionId, positionId, registrationBlock, executionBlock } = dashboardSelection;

  // Required security state. Failure here correctly fails the dashboard closed.
  const [chainId, guardRaw, snapshotRaw, eventConsumed, resultConsumed, positionCount, managerTokenBalance, extensionId, resultDomain] = await Promise.all([
    publicClient.getChainId(),
    publicClient.readContract({ address: contracts.guardManager, abi: guardManagerAbi, functionName: "getGuard", args: [ruleId] }),
    publicClient.readContract({ address: contracts.guardManager, abi: guardManagerAbi, functionName: "getEvaluationSnapshot", args: [eventHash] }),
    publicClient.readContract({ address: contracts.guardManager, abi: guardManagerAbi, functionName: "isEventConsumed", args: [eventHash] }),
    publicClient.readContract({ address: contracts.guardManager, abi: guardManagerAbi, functionName: "isResultConsumed", args: [actionId] }),
    publicClient.readContract({ address: contracts.protectionVault, abi: vaultAbi, functionName: "positionCount" }),
    publicClient.readContract({ address: contracts.ftestXrp, abi: erc20Abi, functionName: "balanceOf", args: [contracts.guardManager] }),
    publicClient.readContract({ address: contracts.guardManager, abi: guardManagerAbi, functionName: "extensionId" }),
    publicClient.readContract({ address: contracts.guardManager, abi: guardManagerAbi, functionName: "GUARD_RESULT_DOMAIN" }),
  ]);
  if (chainId !== 114) throw new Error(`Wrong RPC chain: expected 114, received ${chainId}`);

  const guard = guardRaw as GuardRecord;
  const snapshot = snapshotRaw as EvaluationSnapshot;
  if (getAddress(guard.owner) !== getAddress(owner)) return null;
  if (guard.ruleId !== ruleId || snapshot.ruleId !== ruleId) throw new Error("Configured guard selectors do not match required onchain state");

  // Receipt-anchored log reads remain useful evidence, but never take down core state.
  const [registrations, preparedLogs, evaluatedLogs, triggeredLogs, livePrice] = await Promise.all([
    optional("GuardRegistered history", () => publicClient.getLogs({ address: contracts.guardManager, event: guardRegisteredEvent, args: { owner, ruleId }, fromBlock: registrationBlock, toBlock: registrationBlock })),
    optional("GuardEvaluationPrepared history", () => publicClient.getLogs({ address: contracts.guardManager, event: guardPreparedEvent, args: { owner, ruleId, eventHash }, fromBlock: registrationBlock, toBlock: registrationBlock })),
    optional("GuardEvaluated history", () => publicClient.getLogs({ address: contracts.guardManager, event: guardEvaluatedEvent, args: { owner, ruleId, eventHash }, fromBlock: executionBlock, toBlock: executionBlock })),
    optional("GuardTriggered history", () => publicClient.getLogs({ address: contracts.guardManager, event: guardTriggeredEvent, args: { owner, ruleId, eventHash }, fromBlock: executionBlock, toBlock: executionBlock })),
    optional("current FTSO feed", () => publicClient.readContract({ address: contracts.priceReader, abi: priceReaderAbi, functionName: "getXrpUsdPriceUsd18" })),
  ]);
  const registration = last(registrations);
  const prepared = last(preparedLogs);
  const evaluated = last(evaluatedLogs);
  const triggered = last(triggeredLogs);

  let position: VaultPosition | undefined;
  let claimable = 0n, remainingLocked = 0n, fullyVested = false;
  if (positionCount >= positionId) {
    const positionReads = await Promise.all([
      optional("ProtectionVault.getPosition", () => publicClient.readContract({ address: contracts.protectionVault, abi: vaultAbi, functionName: "getPosition", args: [positionId] })),
      optional("ProtectionVault.claimableAmount", () => publicClient.readContract({ address: contracts.protectionVault, abi: vaultAbi, functionName: "claimableAmount", args: [positionId] })),
      optional("ProtectionVault.remainingLockedAmount", () => publicClient.readContract({ address: contracts.protectionVault, abi: vaultAbi, functionName: "remainingLockedAmount", args: [positionId] })),
      optional("ProtectionVault.isFullyVested", () => publicClient.readContract({ address: contracts.protectionVault, abi: vaultAbi, functionName: "isFullyVested", args: [positionId] })),
    ]);
    position = positionReads[0] as VaultPosition | undefined;
    claimable = positionReads[1] ?? 0n;
    remainingLocked = positionReads[2] ?? 0n;
    fullyVested = positionReads[3] ?? false;
    if (position && getAddress(position.beneficiary) !== getAddress(owner)) throw new Error("Configured vault position belongs to a different beneficiary");
  }

  let tee: DashboardData["tee"];
  if (contracts.currentTee) {
    tee = await optional("current TEE registry metadata", async () => {
      const [machine, status, teeExtension] = await Promise.all([
        publicClient.readContract({ address: contracts.teeManager, abi: teeManagerAbi, functionName: "getTeeMachine", args: [contracts.currentTee!] }),
        publicClient.readContract({ address: contracts.teeManager, abi: teeManagerAbi, functionName: "getTeeMachineStatus", args: [contracts.currentTee!] }),
        publicClient.readContract({ address: contracts.teeManager, abi: teeManagerAbi, functionName: "getExtensionId", args: [contracts.currentTee!] }),
      ]);
      return { id: machine.teeId, proxy: machine.teeProxyId, url: machine.url, status, extensionId: teeExtension };
    });
  }

  return {
    guard, snapshot, eventHash, eventConsumed, actionId,
    decisionTriggered: evaluated?.args.triggered ?? Boolean(triggered), resultConsumed, position, positionCount,
    claimable, remainingLocked, fullyVested, managerTokenBalance, livePriceUsd18: livePrice?.[0], livePriceTimestamp: livePrice?.[1],
    extensionId, resultDomain, tee,
    transactions: { registration: registration?.transactionHash, preparation: prepared?.transactionHash, evaluation: evaluated?.transactionHash, execution: triggered?.transactionHash },
  };
}

export const dashboardReadDiagnostics = { optional };

export async function readGuard(ruleId: `0x${string}`): Promise<GuardRecord> {
  const chainId = await publicClient.getChainId();
  if (chainId !== 114) throw new Error(`Wrong RPC chain: expected 114, received ${chainId}`);
  return await publicClient.readContract({ address: contracts.guardManager, abi: guardManagerAbi, functionName: "getGuard", args: [ruleId] }) as GuardRecord;
}
