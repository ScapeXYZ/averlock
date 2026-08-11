import assert from "node:assert/strict";
import test from "node:test";
import { createPublicClient, http, parseAbiItem } from "viem";
import { createRateLimitedFetch } from "../src/rpc-pacer.mjs";

const rpcUrl = process.env.AVERLOCK_RPC_URL || "https://coston2-api.flare.network/ext/C/rpc";
const guardManager = (process.env.AVERLOCK_CONTRACT_ADDRESSES || "0x444947Aaa00aB3fddbeb6421244A160448E6B52D,0xCcF6D8A6AA0F3799f6c9c6069289D4013aABF4Eb")
  .split(",")[0]
  .trim()
  .toLowerCase();
const startBlock = BigInt(process.env.AVERLOCK_START_BLOCK || "33660559");
const guardEvaluated = parseAbiItem("event GuardEvaluated(address indexed owner, bytes32 indexed ruleId, bytes32 indexed eventHash, bytes32 actionId, bool triggered, uint256 eventValueUsd18)");

test("Coston2 accepts consecutive <=30-block filtered eth_getLogs requests at 2 RPS", async () => {
  const requestStarts = [];
  const pacedFetch = createRateLimitedFetch({
    requestsPerSecond: 2,
    fetchFn: async (...args) => { requestStarts.push(Date.now()); return fetch(...args); },
  });
  const client = createPublicClient({ transport: http(rpcUrl, { fetchFn: pacedFetch, timeout: 0, retryCount: 0 }) });
  for (let range = 0n; range < 5n; range++) {
    const fromBlock = startBlock + range * 30n;
    const logs = await client.getLogs({ address: guardManager, event: guardEvaluated, fromBlock, toBlock: fromBlock + 29n });
    assert.ok(Array.isArray(logs));
  }
  assert.equal(requestStarts.length, 5);
  for (let index = 1; index < requestStarts.length; index++) assert.ok(requestStarts[index] - requestStarts[index - 1] >= 450);
});
