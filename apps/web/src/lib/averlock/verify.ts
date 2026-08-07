import { getAddress, type Address, type Hex } from "viem";
import { configuredDetailAnchor, isValidGuardRuleId, readGuardDetail } from "./guard-detail";
import { contracts, dashboardSelection, fccConfig, publicClient, publicProofMetadata } from "./config";
import { priceReaderAbi, teeManagerAbi } from "./contracts";
import { withReadTimeout } from "./read-timeout";
import type { GuardIndexEntry } from "./guard-index";
import type { GuardDetailAnchor, GuardDetailData } from "./types";

export type VerificationNode = { id: "xrpl" | "fdc" | "ftso" | "fcc" | "manager" | "vault"; label: string; state: "verified" | "waiting" | "unavailable" | "failed"; detail: string };
export type VerifyData = { detail: GuardDetailData; livePriceUsd18?: bigint; livePriceTimestamp?: bigint; tee?: { id: Address; proxy: Address; url: string; status: number; extensionId: bigint }; nodes: VerificationNode[]; optionalErrors: string[] };
type VerifyClient = Pick<typeof publicClient, "getChainId" | "readContract" | "getLogs">;

export function resolveVerificationRule(query: string, entries: GuardIndexEntry[]): Hex | undefined {
  const value = query.trim();
  if (isValidGuardRuleId(value)) {
    if (value.toLowerCase() === dashboardSelection.eventHash.toLowerCase() || value.toLowerCase() === dashboardSelection.actionId.toLowerCase()) return dashboardSelection.ruleId;
    const receipt = entries.find((entry) => entry.transactionHash.toLowerCase() === value.toLowerCase());
    return receipt?.ruleId || value as Hex;
  }
  if (/^\d+$/.test(value) && BigInt(value) === dashboardSelection.positionId) return dashboardSelection.ruleId;
  return undefined;
}

export function verificationAnchor(ruleId: Hex, owner?: Address, entries: GuardIndexEntry[] = []): GuardDetailAnchor {
  const configured = configuredDetailAnchor(ruleId) || {};
  const indexed = entries.find((entry) => entry.ruleId.toLowerCase() === ruleId.toLowerCase());
  return { ...configured, owner, registrationBlock: indexed ? BigInt(indexed.registrationBlock) : configured.registrationBlock, registrationTransaction: indexed?.transactionHash || configured.registrationTransaction };
}

export async function readVerification(ruleId: Hex, anchor: GuardDetailAnchor, client: VerifyClient = publicClient, timeoutMs = 20_000): Promise<VerifyData> {
  const detail = await readGuardDetail(ruleId, anchor, client);
  const optionalErrors = [...detail.optionalErrors];
  let livePriceUsd18: bigint | undefined; let livePriceTimestamp: bigint | undefined;
  try { [livePriceUsd18, livePriceTimestamp] = await withReadTimeout(client.readContract({ address: contracts.priceReader, abi: priceReaderAbi, functionName: "getXrpUsdPriceUsd18" }), "Current FTSO price", timeoutMs); } catch { optionalErrors.push("Current FTSO price unavailable"); }
  let tee: VerifyData["tee"];
  if (contracts.currentTee) {
    try {
      const [machine, status, extensionId] = await Promise.all([
        withReadTimeout(client.readContract({ address: contracts.teeManager, abi: teeManagerAbi, functionName: "getTeeMachine", args: [contracts.currentTee] }), "TEE machine metadata", timeoutMs),
        withReadTimeout(client.readContract({ address: contracts.teeManager, abi: teeManagerAbi, functionName: "getTeeMachineStatus", args: [contracts.currentTee] }), "TEE machine status", timeoutMs),
        withReadTimeout(client.readContract({ address: contracts.teeManager, abi: teeManagerAbi, functionName: "getExtensionId", args: [contracts.currentTee] }), "TEE extension ID", timeoutMs),
      ]);
      if (getAddress(machine.teeId) !== getAddress(contracts.currentTee) || extensionId !== fccConfig.extensionId || status !== 2) throw new Error("TEE/extension binding mismatch.");
      tee = { id: machine.teeId, proxy: machine.teeProxyId, url: machine.url, status, extensionId };
    } catch (error) { if (error instanceof Error && error.message.includes("binding mismatch")) throw error; optionalErrors.push("Current TEE metadata unavailable"); }
  } else optionalErrors.push("Current TEE identity not configured");
  const snapshot = detail.snapshot;
  const nodes: VerificationNode[] = [
    { id: "xrpl", label: "XRPL", state: snapshot ? "verified" : "waiting", detail: snapshot ? "Payment identity bound in the prepared event" : "No prepared payment event" },
    { id: "fdc", label: "FDC", state: snapshot ? "verified" : "waiting", detail: snapshot ? "XRPPayment proof accepted by GuardManager" : "Proof not yet submitted" },
    { id: "ftso", label: "FTSO", state: snapshot ? "verified" : "waiting", detail: snapshot ? "Stored XRP/USD execution snapshot" : "No stored valuation" },
    { id: "fcc", label: "FCC", state: detail.actionId ? "verified" : "waiting", detail: detail.actionId ? "Signed V2 result recorded" : "Private policy sealed; no decision yet" },
    { id: "manager", label: "GuardManager", state: "verified", detail: detail.eventConsumed ? "Event consumed with replay protection" : "Guard binding verified; event unconsumed" },
    { id: "vault", label: "ProtectionVault", state: detail.position ? "verified" : "waiting", detail: detail.position ? `Position #${detail.position.id} beneficiary verified` : "No vault position yet" },
  ];
  return { detail, livePriceUsd18, livePriceTimestamp, tee, nodes, optionalErrors: [...new Set(optionalErrors)] };
}

export function publicFdcMetadata() { return publicProofMetadata; }
export function verifyViewContainsPrivateData(data: VerifyData) {
  const text = JSON.stringify(data, (_, value) => typeof value === "bigint" ? value.toString() : value).toLowerCase();
  return ["thresholdusd", "protectbps", "maxperevent", "cooldownseconds", "policyexpiry", "plaintext policy"].some((term) => text.includes(term));
}
