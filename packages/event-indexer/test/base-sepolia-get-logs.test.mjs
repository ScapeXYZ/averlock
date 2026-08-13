import test from "node:test";
import assert from "node:assert/strict";
import { createPublicClient, http } from "viem";
test("Base Sepolia supports a bounded filtered log request", { skip: !process.env.BASE_SEPOLIA_LIVE_RPC_TEST }, async () => { const client=createPublicClient({transport:http(process.env.AVERLOCK_RPC_URL||"https://sepolia.base.org")}); assert.equal(await client.getChainId(),84532); const head=await client.getBlockNumber(); const logs=await client.getLogs({fromBlock:head,toBlock:head}); assert.ok(Array.isArray(logs)); });
