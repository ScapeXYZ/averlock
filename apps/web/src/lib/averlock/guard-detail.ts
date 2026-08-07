import { getAddress, isHex, keccak256, stringToHex, zeroAddress, zeroHash, type Address, type Hex } from "viem";
import { contracts, coston2, dashboardSelection, fccConfig, publicClient } from "./config";
import { guardEvaluatedEvent, guardManagerAbi, guardRegisteredEvent, guardTriggeredEvent, vaultAbi } from "./contracts";
import { withReadTimeout } from "./read-timeout";
import type { EvaluationSnapshot, GuardDetailAnchor, GuardDetailData, GuardLifecycleStage, GuardRecord, VaultPosition } from "./types";

type DetailClient = Pick<typeof publicClient, "getChainId" | "readContract" | "getLogs">;

const sameHex = (a?: string, b?: string) => Boolean(a && b && a.toLowerCase() === b.toLowerCase());
const availableSnapshot = (snapshot: EvaluationSnapshot) => snapshot.ruleId !== zeroHash && snapshot.preparedAt > 0n;
const expectedResultDomain = keccak256(stringToHex("AVERLOCK_GUARD_RESULT_V2"));

export const isValidGuardRuleId = (value: string): value is Hex => isHex(value, { strict: true }) && value.length === 66;

export function configuredDetailAnchor(ruleId: Hex): GuardDetailAnchor | undefined {
  if (sameHex(ruleId, "0x58fb549f06329f6f899684687f21ce46a091c51ea27b045b05d4bf10b7dc5a0f")) return {
    registrationBlock: 33_713_049n,
    registrationTransaction: "0xe2abf3d02a16bc3ca8aec1d49fe26eed3ff8e032313d9f6c18692ffe74cb7180",
    eventHash: "0xe755879d5522b80d25c4578e8261da589428adf2af7635c214402eaea2622cc9",
    actionId: "0xdc460e2c4c17435c5fdecce9b56be715c4fb35290c096591aaa06be3155bbc44",
    executionBlock: 33_718_140n,
    executionTransaction: "0x250d7652dad39954e6de2b285bcf0dac1b3a0a84e9d82b590ce37dc1916592db",
  };
  if (!sameHex(ruleId, dashboardSelection.ruleId)) return undefined;
  return {
    registrationBlock: dashboardSelection.registrationBlock,
    eventHash: dashboardSelection.eventHash,
    actionId: dashboardSelection.actionId,
    executionBlock: dashboardSelection.executionBlock,
  };
}

export async function readGuardDetail(ruleId: Hex, anchor: GuardDetailAnchor = {}, client: DetailClient = publicClient): Promise<GuardDetailData> {
  const [chainId, guardRaw, vault, paymentVerifier, priceReader, fxrp, extensionId, resultDomain] = await Promise.all([
    withReadTimeout(client.getChainId(), "Coston2 chain ID"),
    withReadTimeout(client.readContract({ address: contracts.guardManager, abi: guardManagerAbi, functionName: "getGuard", args: [ruleId] }), "GuardManager.getGuard"),
    withReadTimeout(client.readContract({ address: contracts.guardManager, abi: guardManagerAbi, functionName: "protectionVault" }), "GuardManager.protectionVault"),
    withReadTimeout(client.readContract({ address: contracts.guardManager, abi: guardManagerAbi, functionName: "paymentVerifier" }), "GuardManager.paymentVerifier"),
    withReadTimeout(client.readContract({ address: contracts.guardManager, abi: guardManagerAbi, functionName: "priceReader" }), "GuardManager.priceReader"),
    withReadTimeout(client.readContract({ address: contracts.guardManager, abi: guardManagerAbi, functionName: "fxrp" }), "GuardManager.fxrp"),
    withReadTimeout(client.readContract({ address: contracts.guardManager, abi: guardManagerAbi, functionName: "extensionId" }), "GuardManager.extensionId"),
    withReadTimeout(client.readContract({ address: contracts.guardManager, abi: guardManagerAbi, functionName: "GUARD_RESULT_DOMAIN" }), "GuardManager.GUARD_RESULT_DOMAIN"),
  ]);
  if (chainId !== coston2.id) throw new Error(`Wrong chain: expected Coston2 114, received ${chainId}.`);
  const guard = guardRaw as GuardRecord;
  if (guard.owner === zeroAddress || guard.ruleId === zeroHash) throw new Error("No registered guard exists for this rule ID.");
  if (!sameHex(guard.ruleId, ruleId)) throw new Error("Guard rule binding mismatch.");
  if (guard.policyCommitment === zeroHash) throw new Error("Guard policy commitment is missing.");
  if (guard.monitoredReceiverHash === zeroHash) throw new Error("Guard receiver binding is missing.");
  if (anchor.owner && getAddress(anchor.owner) !== getAddress(guard.owner)) throw new Error("Guard owner binding mismatch.");
  if (getAddress(vault as Address) !== getAddress(contracts.protectionVault) || getAddress(paymentVerifier as Address) !== getAddress(contracts.paymentVerifier) || getAddress(priceReader as Address) !== getAddress(contracts.priceReader) || getAddress(fxrp as Address) !== getAddress(contracts.ftestXrp)) throw new Error("GuardManager contract wiring mismatch.");
  if (extensionId !== fccConfig.extensionId) throw new Error("GuardManager FCC extension binding mismatch.");
  if (!sameHex(resultDomain as Hex, expectedResultDomain)) throw new Error("GuardManager FCC result domain mismatch.");

  let registrationTransaction = anchor.registrationTransaction;
  const optionalErrors: string[] = [];
  if (anchor.registrationBlock !== undefined) {
    try {
      const registrations = await withReadTimeout(client.getLogs({ address: contracts.guardManager, event: guardRegisteredEvent, args: { ruleId }, fromBlock: anchor.registrationBlock, toBlock: anchor.registrationBlock }), "GuardRegistered receipt");
      const registration = registrations.find((log) => sameHex(log.args.ruleId, ruleId));
      if (!registration) throw new Error("receipt-anchored GuardRegistered event missing");
      if (getAddress(registration.args.owner!) !== getAddress(guard.owner) || !sameHex(registration.args.policyCommitment, guard.policyCommitment) || !sameHex(registration.args.monitoredReceiverHash, guard.monitoredReceiverHash) || registration.args.scheduleId !== guard.scheduleId) throw new Error("Guard registration event binding mismatch.");
      if (registrationTransaction && !sameHex(registrationTransaction, registration.transactionHash)) throw new Error("Guard registration transaction mismatch.");
      registrationTransaction = registration.transactionHash;
    } catch (error) {
      if (error instanceof Error && /binding mismatch|transaction mismatch/.test(error.message)) throw error;
      optionalErrors.push("Registration receipt evidence unavailable");
    }
  }

  let snapshot: EvaluationSnapshot | undefined;
  let eventConsumed: boolean | undefined;
  if (anchor.eventHash) {
    try {
      const raw = await withReadTimeout(client.readContract({ address: contracts.guardManager, abi: guardManagerAbi, functionName: "getEvaluationSnapshot", args: [anchor.eventHash] }), "GuardManager.getEvaluationSnapshot") as EvaluationSnapshot;
      if (availableSnapshot(raw)) {
        if (!sameHex(raw.ruleId, guard.ruleId)) throw new Error("Guard snapshot rule binding mismatch.");
        snapshot = raw;
        eventConsumed = await withReadTimeout(client.readContract({ address: contracts.guardManager, abi: guardManagerAbi, functionName: "isEventConsumed", args: [anchor.eventHash] }), "GuardManager.isEventConsumed");
      }
    } catch (error) {
      if (error instanceof Error && /binding mismatch|transaction mismatch/.test(error.message)) throw error;
      optionalErrors.push("Evaluation snapshot unavailable");
    }
  }

  let actionId = anchor.actionId;
  let resultConsumed: boolean | undefined;
  let decisionTriggered: boolean | undefined;
  let executionTransaction: Hex | undefined;
  let positionId: bigint | undefined;
  if (anchor.executionBlock !== undefined && anchor.eventHash) {
    try {
      const [evaluations, triggers] = await Promise.all([
        withReadTimeout(client.getLogs({ address: contracts.guardManager, event: guardEvaluatedEvent, args: { owner: guard.owner, ruleId, eventHash: anchor.eventHash }, fromBlock: anchor.executionBlock, toBlock: anchor.executionBlock }), "GuardEvaluated receipt"),
        withReadTimeout(client.getLogs({ address: contracts.guardManager, event: guardTriggeredEvent, args: { owner: guard.owner, ruleId, eventHash: anchor.eventHash }, fromBlock: anchor.executionBlock, toBlock: anchor.executionBlock }), "GuardTriggered receipt"),
      ]);
      const evaluated = evaluations.at(-1); const triggered = triggers.at(-1);
      if (evaluated) {
        const evaluatedActionId = evaluated.args.actionId!;
        if (actionId && !sameHex(actionId, evaluatedActionId)) throw new Error("Guard result action binding mismatch.");
        actionId = evaluatedActionId; decisionTriggered = evaluated.args.triggered;
        resultConsumed = await withReadTimeout(client.readContract({ address: contracts.guardManager, abi: guardManagerAbi, functionName: "isResultConsumed", args: [evaluatedActionId] }), "GuardManager.isResultConsumed");
        if (anchor.executionTransaction && !sameHex(anchor.executionTransaction, evaluated.transactionHash)) throw new Error("Guard execution transaction mismatch.");
        executionTransaction = evaluated.transactionHash;
      }
      if (triggered) { positionId = triggered.args.vaultPositionId; executionTransaction = triggered.transactionHash; }
    } catch (error) {
      if (error instanceof Error && /binding mismatch|transaction mismatch/.test(error.message)) throw error;
      optionalErrors.push("Execution receipt evidence unavailable");
    }
  }

  let position: VaultPosition | undefined; let claimable: bigint | undefined; let remainingLocked: bigint | undefined; let fullyVested: boolean | undefined;
  if (positionId !== undefined) {
    const [raw, claimableRaw, lockedRaw, vestedRaw] = await Promise.all([
      withReadTimeout(client.readContract({ address: contracts.protectionVault, abi: vaultAbi, functionName: "getPosition", args: [positionId] }), "ProtectionVault.getPosition"),
      withReadTimeout(client.readContract({ address: contracts.protectionVault, abi: vaultAbi, functionName: "claimableAmount", args: [positionId] }), "ProtectionVault.claimableAmount"),
      withReadTimeout(client.readContract({ address: contracts.protectionVault, abi: vaultAbi, functionName: "remainingLockedAmount", args: [positionId] }), "ProtectionVault.remainingLockedAmount"),
      withReadTimeout(client.readContract({ address: contracts.protectionVault, abi: vaultAbi, functionName: "isFullyVested", args: [positionId] }), "ProtectionVault.isFullyVested"),
    ]);
    position = raw as VaultPosition;
    if (position.id !== positionId || getAddress(position.beneficiary) !== getAddress(guard.owner) || getAddress(position.asset) !== getAddress(contracts.ftestXrp)) throw new Error("ProtectionVault beneficiary or asset binding mismatch.");
    claimable = claimableRaw; remainingLocked = lockedRaw; fullyVested = vestedRaw;
  }

  // A false FCC decision is still a completed, replay-protected evaluation and
  // intentionally creates no vault position. A triggered decision must retain
  // the stricter position requirement.
  const executed = Boolean(eventConsumed && resultConsumed && (decisionTriggered === false || position));
  const lifecycle: GuardLifecycleStage[] = [
    { id: "payment", label: "XRPL Payment", state: snapshot ? "verified" : "waiting", detail: snapshot ? "Payment bound to the prepared event" : "Waiting for a qualifying XRP payment" },
    { id: "fdc", label: "FDC Proof", state: snapshot ? "verified" : "waiting", detail: snapshot ? "XRPLPayment proof accepted onchain" : "Not yet submitted" },
    { id: "ftso", label: "FTSO Snapshot", state: snapshot ? "verified" : "waiting", detail: snapshot ? "XRP/USD snapshot stored" : "Created after FDC verification" },
    { id: "fcc", label: "Private FCC Decision", state: actionId ? "verified" : "waiting", detail: actionId ? "Signed result bound to this event" : "Private policy remains sealed" },
    { id: "execution", label: "Guard Execution", state: eventConsumed ? "executed" : "waiting", detail: eventConsumed ? "Event consumed with replay protection" : "Not yet triggered" },
    { id: "vault", label: "ProtectionVault", state: position ? "executed" : decisionTriggered === false ? "verified" : "waiting", detail: position ? `Position #${position.id}` : decisionTriggered === false ? "No position required by the FCC decision" : "No position created" },
  ];
  return { guard, status: executed ? "executed" : guard.active ? "active" : "expired", registrationTransaction, registrationBlock: anchor.registrationBlock, snapshot, eventHash: anchor.eventHash, eventConsumed, actionId, resultConsumed, decisionTriggered, executionTransaction, position, claimable, remainingLocked, fullyVested, extensionId, resultDomain: resultDomain as Hex, lifecycle, optionalErrors };
}
