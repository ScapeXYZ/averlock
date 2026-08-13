import assert from "node:assert/strict";
import {
  createPublicClient,
  getAddress,
  http,
  parseAbi,
  parseAbiItem,
} from "viem";

const rpcUrl =
  process.env.NEXT_PUBLIC_BASE_SEPOLIA_RPC_URL || "https://sepolia.base.org";
const guardManager = getAddress(
  process.env.NEXT_PUBLIC_BASE_GUARD_MANAGER ||
    "0xB2d5B8a9dF91466F07fcBA92f334cb143197151d",
);
const protectionVault = getAddress(
  process.env.NEXT_PUBLIC_BASE_PROTECTION_VAULT ||
    "0x5f7a95160A34e84B91e25903b69B8B378094a9B0",
);
const approvedToken = getAddress(
  process.env.NEXT_PUBLIC_BASE_APPROVED_TOKEN ||
    "0x036CbD53842c5426634e7929541eC2318f3dCF7e",
);
const deploymentBlock = 45_438_094n;
const client = createPublicClient({ transport: http(rpcUrl) });
const managerAbi = parseAbi([
  "function VERSION() view returns (string)",
  "function protectionVault() view returns (address)",
  "function isApprovedAsset(address) view returns (bool)",
]);
const tokenAbi = parseAbi([
  "function symbol() view returns (string)",
  "function decimals() view returns (uint8)",
]);
const guardCreated = parseAbiItem(
  "event GuardCreated(uint256 indexed guardId,address indexed owner,address indexed asset,uint8 guardType,uint256 amount,uint64 cooldown,uint64 releaseDuration,uint64 createdAt)",
);

const chainId = await client.getChainId();
assert.equal(chainId, 84_532, "RPC is not Base Sepolia");
const [managerCode, vaultCode, tokenCode, vaultBinding, approved, version, symbol, decimals, logs] =
  await Promise.all([
    client.getBytecode({ address: guardManager }),
    client.getBytecode({ address: protectionVault }),
    client.getBytecode({ address: approvedToken }),
    client.readContract({
      address: guardManager,
      abi: managerAbi,
      functionName: "protectionVault",
    }),
    client.readContract({
      address: guardManager,
      abi: managerAbi,
      functionName: "isApprovedAsset",
      args: [approvedToken],
    }),
    client.readContract({
      address: guardManager,
      abi: managerAbi,
      functionName: "VERSION",
    }),
    client.readContract({
      address: approvedToken,
      abi: tokenAbi,
      functionName: "symbol",
    }),
    client.readContract({
      address: approvedToken,
      abi: tokenAbi,
      functionName: "decimals",
    }),
    client.getLogs({
      address: guardManager,
      event: guardCreated,
      fromBlock: deploymentBlock,
      toBlock: deploymentBlock,
    }),
  ]);

assert.ok(managerCode && managerCode !== "0x", "GuardManager has no bytecode");
assert.ok(vaultCode && vaultCode !== "0x", "ProtectionVault has no bytecode");
assert.ok(tokenCode && tokenCode !== "0x", "Approved token has no bytecode");
assert.equal(getAddress(vaultBinding), protectionVault, "Vault binding mismatch");
assert.equal(approved, true, "Configured token is not approved");
assert.equal(decimals, 6, "Configured USDC must use 6 decimals");
assert.equal(symbol, "USDC", "Configured token is not USDC");
assert.ok(version.startsWith("1.0.0"), "Unexpected GuardManager version");
assert.ok(Array.isArray(logs), "Filtered deployment-block log request failed");

console.log(
  JSON.stringify(
    {
      chainId,
      guardManager,
      protectionVault,
      approvedToken,
      deploymentBlock: deploymentBlock.toString(),
      version,
      symbol,
      decimals,
      status: "verified-read-only",
    },
    null,
    2,
  ),
);
