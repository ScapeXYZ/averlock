import { getAddress, type Address, type Hex } from "viem";
import { contracts, coston2, dashboardSelection, publicClient } from "./config";
import { guardManagerAbi, guardTriggeredEvent, vaultAbi } from "./contracts";
import type { GuardRecord, VaultPosition } from "./types";

export type VaultAnchor = { positionId: bigint; ruleId?: Hex; eventHash?: Hex; executionBlock?: bigint };
export type VaultStatus = "locked" | "releasing" | "fully-vested" | "claimed";
export type VaultView = {
  position: VaultPosition; claimable?: bigint; remainingLocked?: bigint; fullyVested?: boolean; status: VaultStatus;
  originatingRule?: Hex; executionTransaction?: Hex; optionalErrors: string[];
};
export type VaultsData = { positionCount: bigint; positions: VaultView[]; totalProtected: bigint; totalClaimable: bigint; totalLocked: bigint };

export const configuredVaultAnchors = (): VaultAnchor[] => [{ positionId: dashboardSelection.positionId, ruleId: dashboardSelection.ruleId, eventHash: dashboardSelection.eventHash, executionBlock: dashboardSelection.executionBlock }];
export const canClaimPosition = (item: VaultView, owner: Address, chainId: number) => chainId === coston2.id && getAddress(item.position.beneficiary) === getAddress(owner) && item.claimable !== undefined && item.claimable > 0n;
type VaultClient = Pick<typeof publicClient, "getChainId" | "readContract" | "getLogs">;

async function optional<T>(label: string, errors: string[], read: () => Promise<T>) {
  try { return await read(); } catch { errors.push(label); return undefined; }
}

export async function readWalletVaults(owner: Address, anchors: VaultAnchor[] = configuredVaultAnchors(), client: VaultClient = publicClient): Promise<VaultsData> {
  const [chainId, positionCount, managerVault] = await Promise.all([
    client.getChainId(),
    client.readContract({ address: contracts.protectionVault, abi: vaultAbi, functionName: "positionCount" }),
    client.readContract({ address: contracts.guardManager, abi: guardManagerAbi, functionName: "protectionVault" }),
  ]);
  if (chainId !== coston2.id) throw new Error(`Wrong chain: expected Coston2 114, received ${chainId}.`);
  if (getAddress(managerVault) !== getAddress(contracts.protectionVault)) throw new Error("GuardManager ProtectionVault binding mismatch.");

  const unique = [...new Map(anchors.map((anchor) => [anchor.positionId.toString(), anchor])).values()]
    .filter((anchor) => anchor.positionId > 0n && anchor.positionId <= positionCount);
  const positions: VaultView[] = [];
  for (const anchor of unique) {
    const raw = await client.readContract({ address: contracts.protectionVault, abi: vaultAbi, functionName: "getPosition", args: [anchor.positionId] }) as VaultPosition;
    if (raw.id !== anchor.positionId || raw.asset === "0x0000000000000000000000000000000000000000" || raw.beneficiary === "0x0000000000000000000000000000000000000000" || raw.endTimestamp <= raw.startTimestamp) throw new Error(`Invalid vault position ${anchor.positionId}.`);
    let guard: GuardRecord | undefined;
    if (anchor.ruleId) {
      guard = await client.readContract({ address: contracts.guardManager, abi: guardManagerAbi, functionName: "getGuard", args: [anchor.ruleId] }) as GuardRecord;
      if (guard.ruleId.toLowerCase() !== anchor.ruleId.toLowerCase() || getAddress(guard.owner) !== getAddress(raw.beneficiary)) throw new Error(`Vault beneficiary mismatch for position ${anchor.positionId}.`);
    }
    if (getAddress(raw.beneficiary) !== getAddress(owner)) continue;
    const errors: string[] = [];
    const [claimable, remainingLocked, fullyVested] = await Promise.all([
      optional("Claimable amount unavailable", errors, () => client.readContract({ address: contracts.protectionVault, abi: vaultAbi, functionName: "claimableAmount", args: [anchor.positionId] })),
      optional("Remaining locked amount unavailable", errors, () => client.readContract({ address: contracts.protectionVault, abi: vaultAbi, functionName: "remainingLockedAmount", args: [anchor.positionId] })),
      optional("Vesting status unavailable", errors, () => client.readContract({ address: contracts.protectionVault, abi: vaultAbi, functionName: "isFullyVested", args: [anchor.positionId] })),
    ]);
    let executionTransaction: Hex | undefined;
    if (anchor.ruleId && anchor.eventHash && anchor.executionBlock !== undefined) {
      const logs = await optional("Execution receipt unavailable", errors, () => client.getLogs({ address: contracts.guardManager, event: guardTriggeredEvent, args: { owner, ruleId: anchor.ruleId, eventHash: anchor.eventHash }, fromBlock: anchor.executionBlock, toBlock: anchor.executionBlock }));
      const triggered = logs?.find((log) => log.args.vaultPositionId === anchor.positionId);
      if (logs && !triggered) throw new Error(`Vault execution binding mismatch for position ${anchor.positionId}.`);
      executionTransaction = triggered?.transactionHash;
    }
    const status: VaultStatus = raw.claimed >= raw.totalDeposited ? "claimed" : fullyVested ? "fully-vested" : (claimable || 0n) > 0n ? "releasing" : "locked";
    positions.push({ position: raw, claimable, remainingLocked, fullyVested, status, originatingRule: guard?.ruleId, executionTransaction, optionalErrors: errors });
  }
  return {
    positionCount: BigInt(positions.length), positions,
    totalProtected: positions.reduce((sum, item) => sum + item.position.totalDeposited, 0n),
    totalClaimable: positions.reduce((sum, item) => sum + (item.claimable || 0n), 0n),
    totalLocked: positions.reduce((sum, item) => sum + (item.remainingLocked || 0n), 0n),
  };
}
