import assert from "node:assert/strict";
import test from "node:test";
import { createPublicClient, http, parseAbiItem } from "viem";

const rpcUrl = process.env.AVERLOCK_RPC_URL || "https://coston2-api.flare.network/ext/C/rpc";
const guardManager = (process.env.AVERLOCK_CONTRACT_ADDRESSES || "0x444947Aaa00aB3fddbeb6421244A160448E6B52D,0xCcF6D8A6AA0F3799f6c9c6069289D4013aABF4Eb")
  .split(",")[0]
  .trim()
  .toLowerCase();
const startBlock = BigInt(process.env.AVERLOCK_START_BLOCK || "33660559");
const guardEvaluated = parseAbiItem("event GuardEvaluated(address indexed owner, bytes32 indexed ruleId, bytes32 indexed eventHash, bytes32 actionId, bool triggered, uint256 eventValueUsd18)");

test("Coston2 accepts viem's filtered eth_getLogs request for one historical block", async () => {
  const client = createPublicClient({ transport: http(rpcUrl, { timeout: 20_000, retryCount: 0 }) });
  const logs = await client.getLogs({
    address: guardManager,
    event: guardEvaluated,
    fromBlock: startBlock,
    toBlock: startBlock,
  });

  assert.ok(Array.isArray(logs));
});
