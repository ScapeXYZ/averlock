import { parseAbi, parseAbiItem } from "viem";

export const guardManagerAbi = parseAbi([
  "function registerGuard(bytes32 ruleId, bytes32 policyCommitment, bytes32 monitoredReceiverHash, uint32 scheduleId)",
  "function getGuard(bytes32) view returns ((address owner, bytes32 ruleId, bytes32 policyCommitment, bytes32 monitoredReceiverHash, uint32 scheduleId, bool active, uint64 createdAt))",
  "function getEvaluationSnapshot(bytes32) view returns ((bytes32 ruleId, uint256 eventValueUsd18, uint256 priceUsd18, uint64 priceTimestamp, uint64 paymentTimestamp, uint64 preparedAt))",
  "function isEventConsumed(bytes32) view returns (bool)",
  "function isResultConsumed(bytes32) view returns (bool)",
  "function isNonceUsed(bytes32,uint256) view returns (bool)",
  "function deriveEventHash(bytes32,bytes32,uint256,uint64) pure returns (bytes32)",
  "function prepareGuardEvaluation(bytes32,(bytes32[],(bytes32,bytes32,uint64,uint64,(bytes32,address),(uint64,uint64,string,bytes32,bytes32,bytes32,int256,int256,int256,int256,bool,bytes,bool,uint256,uint8)))) returns (bytes32,uint256,uint256,uint64)",
  "function executeGuard(bytes32,bytes32,(bytes32 actionId,string submissionTag,uint8 status,bytes data,bytes signature)) returns (bool,uint256,uint256)",
  "function protectionVault() view returns (address)",
  "function paymentVerifier() view returns (address)",
  "function priceReader() view returns (address)",
  "function fxrp() view returns (address)",
  "function teeManager() view returns (address)",
  "function extensionId() view returns (uint256)",
  "function maxPriceAge() view returns (uint64)",
  "function GUARD_RESULT_DOMAIN() view returns (bytes32)",
]);

export const instructionSenderAbi = parseAbi([
  "function createPolicy(bytes encryptedPolicyEnvelope) payable",
  "function evaluateGuard(bytes evaluationContext) payable",
]);

export const teeInstructionsSentEvent = {
  type: "event", name: "TeeInstructionsSent", anonymous: false,
  inputs: [
    { indexed: true, name: "extensionId", type: "uint256" },
    { indexed: true, name: "instructionId", type: "bytes32" },
    { indexed: true, name: "rewardEpochId", type: "uint32" },
    { indexed: false, name: "teeMachines", type: "tuple[]", components: [{ name: "teeId", type: "address" }, { name: "teeProxyId", type: "address" }, { name: "url", type: "string" }] },
    { indexed: false, name: "opType", type: "bytes32" }, { indexed: false, name: "opCommand", type: "bytes32" },
    { indexed: false, name: "message", type: "bytes" }, { indexed: false, name: "cosigners", type: "address[]" },
    { indexed: false, name: "cosignersThreshold", type: "uint64" }, { indexed: false, name: "claimBackAddress", type: "address" },
    { indexed: false, name: "fee", type: "uint256" },
  ],
} as const;

export const vaultAbi = parseAbi([
  "function positionCount() view returns (uint256)",
  "function claim(uint256 positionId) returns (uint256 amount)",
  "function getPosition(uint256) view returns ((uint256 id, address asset, address beneficiary, uint256 totalDeposited, uint256 claimed, uint64 startTimestamp, uint64 endTimestamp, uint64 createdAt))",
  "function claimableAmount(uint256) view returns (uint256)",
  "function remainingLockedAmount(uint256) view returns (uint256)",
  "function isFullyVested(uint256) view returns (bool)",
]);

export const priceReaderAbi = parseAbi([
  "function getXrpUsdPriceUsd18() view returns (uint256 priceUsd18, uint64 timestamp)",
]);

export const erc20Abi = parseAbi(["function balanceOf(address) view returns (uint256)", "function allowance(address,address) view returns (uint256)", "function approve(address,uint256) returns (bool)"]);

export const teeManagerAbi = parseAbi([
  "function getTeeMachine(address) view returns ((address teeId, address teeProxyId, string url))",
  "function getTeeMachineStatus(address) view returns (uint8)",
  "function getExtensionId(address) view returns (uint256)",
]);

export const guardRegisteredEvent = parseAbiItem("event GuardRegistered(address indexed owner, bytes32 indexed ruleId, bytes32 indexed policyCommitment, bytes32 monitoredReceiverHash, uint32 scheduleId, uint64 createdAt)");
export const guardPreparedEvent = parseAbiItem("event GuardEvaluationPrepared(address indexed owner, bytes32 indexed ruleId, bytes32 indexed eventHash, uint256 eventValueUsd18, uint256 priceUsd18, uint64 priceTimestamp, uint64 paymentTimestamp)");
export const guardEvaluatedEvent = parseAbiItem("event GuardEvaluated(address indexed owner, bytes32 indexed ruleId, bytes32 indexed eventHash, bytes32 actionId, bool triggered, uint256 eventValueUsd18)");
export const guardTriggeredEvent = parseAbiItem("event GuardTriggered(address indexed owner, bytes32 indexed ruleId, bytes32 indexed eventHash, uint256 vaultPositionId, uint256 fxrpAmountProtected, uint32 scheduleId)");
export const vaultPositionCreatedEvent = parseAbiItem("event PositionCreated(uint256 indexed positionId, address indexed depositor, address indexed beneficiary, address asset, uint256 amount, uint64 startTimestamp, uint64 endTimestamp, uint64 createdAt)");
export const vaultClaimedEvent = parseAbiItem("event Claimed(uint256 indexed positionId, address indexed beneficiary, address indexed asset, uint256 amount, uint256 totalClaimed)");
