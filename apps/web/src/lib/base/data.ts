import { getAddress, type Address, type Hex } from "viem";
import {
  baseContracts,
  basePublicClient,
  deploymentConfigured,
} from "./config";
import { baseErc20Abi, baseGuardManagerAbi, baseVaultAbi } from "./contracts";
export const guardStates = [
  "Draft",
  "Registered",
  "Funded",
  "Eligible",
  "Executed",
  "Vault active",
  "Completed",
  "Deactivated",
] as const;
export type BaseGuard = {
  id: bigint;
  owner: Address;
  asset: Address;
  amount: bigint;
  positionId: bigint;
  guardType: number;
  state: number;
  storedState: number;
  cooldown: bigint;
  releaseDuration: bigint;
  createdAt: bigint;
  fundedAt: bigint;
  eligibleAt: bigint;
  executedAt: bigint;
};
export type BasePosition = {
  id: bigint;
  asset: Address;
  beneficiary: Address;
  totalDeposited: bigint;
  claimed: bigint;
  startTimestamp: bigint;
  endTimestamp: bigint;
  createdAt: bigint;
};
export type GuardAnchor = {
  guardId: string;
  transactionHash: Hex;
  blockNumber: string;
  owner: Address;
};
export type ActivityAnchor = { transaction_hash: Hex; block_number: string; event_name: string; payload: Record<string, string | number | boolean> };
const key = (owner: Address) => `averlock:base:guards:${owner.toLowerCase()}`;
export function localAnchors(owner: Address): GuardAnchor[] {
  if (typeof window === "undefined") return [];
  try {
    return (
      JSON.parse(localStorage.getItem(key(owner)) || "[]") as GuardAnchor[]
    ).filter((x) => x.owner.toLowerCase() === owner.toLowerCase());
  } catch {
    return [];
  }
}
export function saveAnchor(anchor: GuardAnchor) {
  const rest = localAnchors(anchor.owner).filter(
    (x) => x.guardId !== anchor.guardId,
  );
  localStorage.setItem(key(anchor.owner), JSON.stringify([anchor, ...rest]));
}
export async function discoverGuards(owner: Address) {
  const local = localAnchors(owner);
  const base = process.env.NEXT_PUBLIC_AVERLOCK_INDEXER_URL;
  if (!base)
    return {
      anchors: local,
      warning:
        "Guard discovery is not configured. Showing only guards created in this browser.",
    };
  let response: Response;
  try {
    response = await fetch(
      `${base.replace(/\/$/, "")}/guards?owner=${owner}`,
      { cache: "no-store", signal: AbortSignal.timeout(10_000) },
    );
  } catch {
    return {
      anchors: local,
      warning:
        "Guard discovery indexer is unreachable. Known guard IDs are still verified from Base Sepolia contracts.",
    };
  }
  if (!response.ok)
    return {
      anchors: local,
      warning:
        "Guard discovery is temporarily unavailable. Known guards are still verified from contracts.",
    };
  const body = (await response.json()) as {
    items?: {
      transaction_hash: Hex;
      block_number: string;
      payload: { guardId: string };
    }[];
  };
  const remote = (body.items || []).map((item) => ({
    guardId: item.payload.guardId,
    transactionHash: item.transaction_hash,
    blockNumber: item.block_number,
    owner,
  }));
  return {
    anchors: [
      ...new Map([...local, ...remote].map((x) => [x.guardId, x])).values(),
    ],
  };
}
export async function discoverActivity(owner: Address) {
  const base = process.env.NEXT_PUBLIC_AVERLOCK_INDEXER_URL;
  const local = localAnchors(owner).map((item) => ({ transaction_hash: item.transactionHash, block_number: item.blockNumber, event_name: "GuardCreated", payload: { guardId: item.guardId } } satisfies ActivityAnchor));
  if (!base) return { items: local, warning: "Activity indexing is not configured. Showing confirmed creation receipts from this browser only." };
  let response: Response;
  try {
    response = await fetch(`${base.replace(/\/$/, "")}/activity?owner=${owner}`, { cache: "no-store", signal: AbortSignal.timeout(10_000) });
  } catch {
    return { items: local, warning: "Activity indexer is unreachable. Current contract state remains available." };
  }
  if (!response.ok) return { items: local, warning: "Activity indexing is temporarily unavailable." };
  const body = await response.json() as { items?: ActivityAnchor[]; sync?: { status?: string; lagBlocks?: string } };
  const degraded = body.sync?.status && body.sync.status !== "healthy";
  return {
    items: body.items || [],
    warning: degraded
      ? `Activity indexer is ${body.sync?.status}${body.sync?.lagBlocks ? ` (${body.sync.lagBlocks} blocks behind)` : ""}. Current state is still read from contracts.`
      : undefined,
  };
}
export async function readGuard(id: bigint) {
  if (!deploymentConfigured)
    throw new Error("Base Sepolia contracts are not configured.");
  const [guard, state] = await Promise.all([
    basePublicClient.readContract({
      address: baseContracts.guardManager,
      abi: baseGuardManagerAbi,
      functionName: "getGuard",
      args: [id],
    }),
    basePublicClient.readContract({
      address: baseContracts.guardManager,
      abi: baseGuardManagerAbi,
      functionName: "currentState",
      args: [id],
    }),
  ]);
  return {
    ...(guard as Omit<BaseGuard, "storedState">),
    storedState: Number(guard.state),
    state: Number(state),
  };
}
export async function readWallet(owner: Address) {
  const discovered = await discoverGuards(owner);
  const guards = (
    await Promise.all(
      discovered.anchors.map(async (anchor) => ({
        anchor,
        guard: await readGuard(BigInt(anchor.guardId)),
      })),
    )
  ).filter(({ guard }) => getAddress(guard.owner) === getAddress(owner));
  if (!deploymentConfigured)
    throw new Error("Base Sepolia contracts are not configured.");
  const [symbol, decimals] = await Promise.all([
    basePublicClient.readContract({
      address: baseContracts.approvedToken,
      abi: baseErc20Abi,
      functionName: "symbol",
    }),
    basePublicClient.readContract({
      address: baseContracts.approvedToken,
      abi: baseErc20Abi,
      functionName: "decimals",
    }),
  ]);
  const positions = await Promise.all(
    guards
      .filter(({ guard }) => guard.positionId > 0n)
      .map(async ({ guard }) => {
        const [position, claimable, locked] = await Promise.all([
          basePublicClient.readContract({
            address: baseContracts.protectionVault,
            abi: baseVaultAbi,
            functionName: "getPosition",
            args: [guard.positionId],
          }),
          basePublicClient.readContract({
            address: baseContracts.protectionVault,
            abi: baseVaultAbi,
            functionName: "claimableAmount",
            args: [guard.positionId],
          }),
          basePublicClient.readContract({
            address: baseContracts.protectionVault,
            abi: baseVaultAbi,
            functionName: "remainingLockedAmount",
            args: [guard.positionId],
          }),
        ]);
        return { guard, position: position as BasePosition, claimable, locked };
      }),
  );
  return {
    guards,
    positions,
    symbol,
    decimals: Number(decimals),
    warning: discovered.warning,
  };
}
