import { decodeEventLog, getAddress, type Address, type Hex, type PublicClient, type TransactionReceipt } from "viem";
import { contracts, fccConfig } from "./config";
import { guardManagerAbi, teeInstructionsSentEvent } from "./contracts";
import type { GuardRecord } from "./types";

export type CreationStage = "idle" | "preparing" | "policy-signature" | "policy-confirmation" | "policy-processing" | "guard-signature" | "guard-confirmation" | "verifying" | "complete" | "failed";

export function instructionIdFromReceipt(receipt: TransactionReceipt): Hex {
  for (const log of receipt.logs) {
    try {
      const decoded = decodeEventLog({ abi: [teeInstructionsSentEvent], data: log.data, topics: log.topics });
      if (decoded.eventName === "TeeInstructionsSent" && decoded.args.extensionId === fccConfig.extensionId) return decoded.args.instructionId;
    } catch { /* Other logs in the same receipt are intentionally ignored. */ }
  }
  throw new Error("The confirmed transaction did not emit the expected FCC instruction ID.");
}

export async function verifyRegisteredGuard(publicClient: PublicClient, expected: { owner: Address; ruleId: Hex; commitment: Hex; receiverHash: Hex; scheduleId: number }) {
  const raw = await publicClient.readContract({ address: contracts.guardManager, abi: guardManagerAbi, functionName: "getGuard", args: [expected.ruleId] });
  const guard = raw as GuardRecord;
  if (getAddress(guard.owner) !== getAddress(expected.owner) || guard.ruleId !== expected.ruleId || guard.policyCommitment !== expected.commitment || guard.monitoredReceiverHash !== expected.receiverHash || guard.scheduleId !== expected.scheduleId || !guard.active) throw new Error("Confirmed guard state does not match the verified policy and payment binding.");
  return guard;
}
