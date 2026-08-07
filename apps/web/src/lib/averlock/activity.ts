import { getAddress, type Address, type Hex } from "viem";
import { contracts, coston2, dashboardSelection, publicClient } from "./config";
import { guardEvaluatedEvent, guardManagerAbi, guardPreparedEvent, guardRegisteredEvent, guardTriggeredEvent, vaultAbi, vaultClaimedEvent, vaultPositionCreatedEvent } from "./contracts";
import type { ClaimReceiptAnchor } from "./activity-index";
import type { GuardIndexEntry } from "./guard-index";
import type { GuardRecord, VaultPosition } from "./types";

export type ActivityCategory = "guards" | "payments" | "verification" | "vaults" | "claims";
export type ActivitySource = "XRPL" | "FDC" | "FTSO" | "FCC" | "GuardManager" | "ProtectionVault";
export type ActivityItem = {
  id: string; category: ActivityCategory; type: string; title: string; description: string; timestamp: bigint; status: "verified" | "executed";
  source: ActivitySource; transactionHash?: Hex; blockNumber?: bigint; ruleId?: Hex; eventHash?: Hex; actionId?: Hex; positionId?: bigint; amount?: bigint;
};
export type ActivityGuardAnchor = { ruleId: Hex; registrationBlock: bigint; registrationTransaction?: Hex; executionBlock?: bigint; eventHash?: Hex; actionId?: Hex; positionId?: bigint };
export type ActivityData = { items: ActivityItem[]; warnings: string[] };
type ActivityClient = Pick<typeof publicClient, "getChainId" | "readContract" | "getLogs" | "getBlock">;

const same = (left: string, right: string) => left.toLowerCase() === right.toLowerCase();
async function optional<T>(label: string, warnings: string[], action: () => Promise<T>) { try { return await action(); } catch { warnings.push(label); return undefined; } }
const item = (value: ActivityItem) => value;

export function activityAnchors(index: GuardIndexEntry[]): ActivityGuardAnchor[] {
  const anchors: ActivityGuardAnchor[] = index.map((entry) => ({ ruleId: entry.ruleId, registrationBlock: BigInt(entry.registrationBlock), registrationTransaction: entry.transactionHash, eventHash: entry.eventHash, actionId: entry.actionId, executionBlock: entry.executionBlock ? BigInt(entry.executionBlock) : undefined, positionId: entry.positionId ? BigInt(entry.positionId) : undefined }));
  anchors.push({ ruleId: dashboardSelection.ruleId, registrationBlock: dashboardSelection.registrationBlock, executionBlock: dashboardSelection.executionBlock, eventHash: dashboardSelection.eventHash, actionId: dashboardSelection.actionId, positionId: dashboardSelection.positionId });
  return [...new Map(anchors.map((anchor) => [anchor.ruleId.toLowerCase(), anchor])).values()];
}

export async function readWalletActivity(owner: Address, anchors: ActivityGuardAnchor[], claims: ClaimReceiptAnchor[] = [], client: ActivityClient = publicClient): Promise<ActivityData> {
  const warnings: string[] = [];
  const [chainId, managerVault] = await Promise.all([
    client.getChainId(), client.readContract({ address: contracts.guardManager, abi: guardManagerAbi, functionName: "protectionVault" }),
  ]);
  if (chainId !== coston2.id) throw new Error(`Wrong chain: expected Coston2 114, received ${chainId}.`);
  if (getAddress(managerVault) !== getAddress(contracts.protectionVault)) throw new Error("GuardManager ProtectionVault binding mismatch.");
  const items: ActivityItem[] = [];

  for (const anchor of anchors) {
    const guard = await optional(`Guard ${anchor.ruleId.slice(0, 10)} unavailable`, warnings, () => client.readContract({ address: contracts.guardManager, abi: guardManagerAbi, functionName: "getGuard", args: [anchor.ruleId] }) as Promise<GuardRecord>);
    if (!guard || !same(guard.ruleId, anchor.ruleId)) continue;
    if (getAddress(guard.owner) !== getAddress(owner)) continue;
    const registrations = await client.getLogs({ address: contracts.guardManager, event: guardRegisteredEvent, args: { owner, ruleId: anchor.ruleId }, fromBlock: anchor.registrationBlock, toBlock: anchor.registrationBlock });
    const registered = registrations.find((log) => same(log.args.policyCommitment || "", guard.policyCommitment));
    if (!registered) throw new Error(`Guard registration binding mismatch for ${anchor.ruleId}.`);
    const registrationTx = registered.transactionHash || anchor.registrationTransaction;
    items.push(item({ id: `guard:${anchor.ruleId}`, category: "guards", type: "guard-created", title: "Guard created", description: "Public guard metadata registered and owner binding verified.", timestamp: guard.createdAt, status: "verified", source: "GuardManager", transactionHash: registrationTx, blockNumber: anchor.registrationBlock, ruleId: anchor.ruleId }));
    items.push(item({ id: `policy:${anchor.ruleId}`, category: "verification", type: "policy-commitment", title: "Private policy commitment registered", description: "Private policy sealed. Only its cryptographic commitment is public.", timestamp: guard.createdAt, status: "verified", source: "FCC", transactionHash: registrationTx, blockNumber: anchor.registrationBlock, ruleId: anchor.ruleId }));

    if (!anchor.executionBlock || !anchor.eventHash) continue;
    const preparedLogs = await optional("FTSO snapshot receipt unavailable", warnings, () => client.getLogs({ address: contracts.guardManager, event: guardPreparedEvent, args: { owner, ruleId: anchor.ruleId, eventHash: anchor.eventHash }, fromBlock: anchor.executionBlock!, toBlock: anchor.executionBlock! }));
    const prepared = preparedLogs?.[0];
    if (prepared) {
      items.push(item({ id: `payment:${anchor.eventHash}`, category: "payments", type: "payment-verified", title: "XRPL payment verified", description: "The payment event is bound to a finalized FDC proof.", timestamp: BigInt(prepared.args.paymentTimestamp || 0), status: "verified", source: "FDC", transactionHash: prepared.transactionHash, blockNumber: anchor.executionBlock, ruleId: anchor.ruleId, eventHash: anchor.eventHash }));
      items.push(item({ id: `price:${anchor.eventHash}`, category: "verification", type: "ftso-snapshot", title: "FTSO price snapshot prepared", description: "XRP/USD valuation was stored for deterministic guard execution.", timestamp: BigInt(prepared.args.priceTimestamp || 0), status: "verified", source: "FTSO", transactionHash: prepared.transactionHash, blockNumber: anchor.executionBlock, ruleId: anchor.ruleId, eventHash: anchor.eventHash }));
    }
    const evaluatedLogs = await optional("FCC decision receipt unavailable", warnings, () => client.getLogs({ address: contracts.guardManager, event: guardEvaluatedEvent, args: { owner, ruleId: anchor.ruleId, eventHash: anchor.eventHash }, fromBlock: anchor.executionBlock!, toBlock: anchor.executionBlock! }));
    const triggeredLogs = await optional("Guard execution receipt unavailable", warnings, () => client.getLogs({ address: contracts.guardManager, event: guardTriggeredEvent, args: { owner, ruleId: anchor.ruleId, eventHash: anchor.eventHash }, fromBlock: anchor.executionBlock!, toBlock: anchor.executionBlock! }));
    const evaluated = evaluatedLogs?.find((log) => !anchor.actionId || same(log.args.actionId || "", anchor.actionId));
    const triggered = triggeredLogs?.find((log) => !anchor.positionId || log.args.vaultPositionId === anchor.positionId);
    const block = (evaluated || triggered) ? await optional("Execution block timestamp unavailable", warnings, () => client.getBlock({ blockNumber: anchor.executionBlock! })) : undefined;
    const timestamp = block?.timestamp || 0n;
    if (evaluated) items.push(item({ id: `fcc:${evaluated.args.actionId}`, category: "verification", type: "fcc-decision", title: "Private FCC decision produced", description: "Private policy sealed. The signed public decision was verified onchain.", timestamp, status: "verified", source: "FCC", transactionHash: evaluated.transactionHash, blockNumber: anchor.executionBlock, ruleId: anchor.ruleId, eventHash: anchor.eventHash, actionId: evaluated.args.actionId }));
    if (triggered) {
      items.push(item({ id: `trigger:${anchor.eventHash}`, category: "guards", type: "guard-triggered", title: "Guard triggered", description: "The verified decision executed with replay protection.", timestamp, status: "executed", source: "GuardManager", transactionHash: triggered.transactionHash, blockNumber: anchor.executionBlock, ruleId: anchor.ruleId, eventHash: anchor.eventHash, positionId: triggered.args.vaultPositionId, amount: triggered.args.fxrpAmountProtected }));
      const createdLogs = await optional("Vault creation receipt unavailable", warnings, () => client.getLogs({ address: contracts.protectionVault, event: vaultPositionCreatedEvent, args: { positionId: triggered.args.vaultPositionId, beneficiary: owner }, fromBlock: anchor.executionBlock!, toBlock: anchor.executionBlock! }));
      const created = createdLogs?.find((log) => log.args.amount === triggered.args.fxrpAmountProtected);
      if (!created && createdLogs) throw new Error("ProtectionVault creation binding mismatch.");
      if (created) items.push(item({ id: `vault:${created.args.positionId}`, category: "vaults", type: "vault-created", title: "ProtectionVault position created", description: "Protected FTestXRP entered a non-cancelable linear-release position.", timestamp: BigInt(created.args.createdAt || timestamp), status: "executed", source: "ProtectionVault", transactionHash: created.transactionHash, blockNumber: anchor.executionBlock, ruleId: anchor.ruleId, eventHash: anchor.eventHash, positionId: created.args.positionId, amount: created.args.amount }));
    }
  }

  for (const claim of claims.filter((entry) => getAddress(entry.owner) === getAddress(owner))) {
    const blockNumber = BigInt(claim.blockNumber); const positionId = BigInt(claim.positionId);
    const claimLogs = await optional(`Claim receipt ${claim.transactionHash.slice(0, 10)} unavailable`, warnings, () => client.getLogs({ address: contracts.protectionVault, event: vaultClaimedEvent, args: { positionId, beneficiary: owner }, fromBlock: blockNumber, toBlock: blockNumber }));
    const claimed = claimLogs?.find((log) => same(log.transactionHash || "", claim.transactionHash));
    if (!claimed) continue;
    const position = await client.readContract({ address: contracts.protectionVault, abi: vaultAbi, functionName: "getPosition", args: [positionId] }) as VaultPosition;
    if (getAddress(position.beneficiary) !== getAddress(owner)) throw new Error(`Claim beneficiary mismatch for position ${positionId}.`);
    const block = await client.getBlock({ blockNumber });
    items.push(item({ id: `claim:${claim.transactionHash}`, category: "claims", type: "vault-claim", title: "Vault claim executed", description: "Vested protection was claimed by the verified beneficiary.", timestamp: block.timestamp, status: "executed", source: "ProtectionVault", transactionHash: claim.transactionHash, blockNumber, positionId, amount: claimed.args.amount }));
  }
  items.sort((a, b) => a.timestamp === b.timestamp ? a.id.localeCompare(b.id) : a.timestamp > b.timestamp ? -1 : 1);
  return { items, warnings: [...new Set(warnings)] };
}

export function activityContainsPrivateData(items: ActivityItem[]) {
  const serialized = JSON.stringify(items, (_, value) => typeof value === "bigint" ? value.toString() : value).toLowerCase();
  return ["thresholdusd", "protectbps", "maxperevent", "cooldownseconds", "policyexpiry", "plaintext policy"].some((term) => serialized.includes(term));
}
