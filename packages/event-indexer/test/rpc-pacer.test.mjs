import assert from "node:assert/strict";
import test from "node:test";
import { createRateLimitedFetch } from "../src/rpc-pacer.mjs";

test("pacer globally spaces concurrent RPC requests", async () => {
  const starts = [];
  const pacedFetch = createRateLimitedFetch({ requestsPerSecond: 20, fetchFn: async () => { starts.push(Date.now()); return new Response("{}", { status: 200 }); } });
  await Promise.all(Array.from({ length: 4 }, () => pacedFetch("https://rpc.invalid")));
  for (let index = 1; index < starts.length; index++) assert.ok(starts[index] - starts[index - 1] >= 40);
});

test("pacer honors Retry-After before retrying a 429", async () => {
  const starts = [];
  let calls = 0;
  const pacedFetch = createRateLimitedFetch({
    requestsPerSecond: 100,
    fetchFn: async () => {
      starts.push(Date.now()); calls += 1;
      return calls === 1 ? new Response("slow down", { status: 429, headers: { "retry-after": "0.05" } }) : new Response("{}", { status: 200 });
    },
  });
  await pacedFetch("https://rpc.invalid");
  assert.equal(calls, 2);
  assert.ok(starts[1] - starts[0] >= 45);
});
