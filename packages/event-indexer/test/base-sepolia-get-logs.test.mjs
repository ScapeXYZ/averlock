import test from "node:test";
import assert from "node:assert/strict";
import { createPublicClient, http, parseAbiItem } from "viem";

const guardManager =
  process.env.AVERLOCK_GUARD_MANAGER ||
  "0xB2d5B8a9dF91466F07fcBA92f334cb143197151d";
const guardCreated = parseAbiItem(
  "event GuardCreated(uint256 indexed guardId,address indexed owner,address indexed asset,uint8 guardType,uint256 amount,uint64 cooldown,uint64 releaseDuration,uint64 createdAt)",
);

test("Base Sepolia supports a bounded AVERLOCK-only filtered log request", { skip: !process.env.BASE_SEPOLIA_LIVE_RPC_TEST }, async () => {
  const client = createPublicClient({ transport: http(process.env.AVERLOCK_RPC_URL || "https://sepolia.base.org") });
  assert.equal(await client.getChainId(), 84532);
  const logs = await client.getLogs({
    address: guardManager,
    event: guardCreated,
    fromBlock: 45_438_094n,
    toBlock: 45_438_094n,
  });
  assert.ok(Array.isArray(logs));
});
