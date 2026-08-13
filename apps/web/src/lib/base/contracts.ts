import { parseAbi, parseAbiItem } from "viem";
export const baseGuardManagerAbi = parseAbi([
  "function VERSION() view returns (string)",
  "function protectionVault() view returns (address)",
  "function isApprovedAsset(address) view returns (bool)",
  "function createGuard(uint8 guardType,address asset,uint256 amount,uint64 cooldown,uint64 releaseDuration) returns (uint256 guardId)",
  "function fundGuard(uint256 guardId)",
  "function executeGuard(uint256 guardId) returns (uint256 positionId)",
  "function completeGuard(uint256 guardId)",
  "function deactivateGuard(uint256 guardId)",
  "function getGuard(uint256) view returns ((uint256 id,address owner,address asset,uint256 amount,uint256 positionId,uint8 guardType,uint8 state,uint64 cooldown,uint64 releaseDuration,uint64 createdAt,uint64 fundedAt,uint64 eligibleAt,uint64 executedAt))",
  "function currentState(uint256) view returns (uint8)",
]);
export const baseVaultAbi = parseAbi([
  "function getPosition(uint256) view returns ((uint256 id,address asset,address beneficiary,uint256 totalDeposited,uint256 claimed,uint64 startTimestamp,uint64 endTimestamp,uint64 createdAt))",
  "function claimableAmount(uint256) view returns (uint256)",
  "function remainingLockedAmount(uint256) view returns (uint256)",
  "function isFullyVested(uint256) view returns (bool)",
  "function isCompleted(uint256) view returns (bool)",
  "function claim(uint256) returns (uint256 amount)",
]);
export const baseErc20Abi = parseAbi([
  "function symbol() view returns (string)",
  "function decimals() view returns (uint8)",
  "function balanceOf(address) view returns (uint256)",
  "function allowance(address,address) view returns (uint256)",
  "function approve(address,uint256) returns (bool)",
]);
export const guardCreatedEvent = parseAbiItem(
  "event GuardCreated(uint256 indexed guardId,address indexed owner,address indexed asset,uint8 guardType,uint256 amount,uint64 cooldown,uint64 releaseDuration,uint64 createdAt)",
);
