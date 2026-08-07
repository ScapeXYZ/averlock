import { expect, test } from "vitest";
import { contracts, dashboardSelection, publicClient } from "./config";
import { guardManagerAbi } from "./contracts";
import { readDashboard } from "./reads";

const completedEventHash = "0xc4d12008caea289e8809d9f2884522ed85aac29600e43d1f07a566c896514819" as const;
const productionTypoEventHash = "0xc4d12c008caea289e8809d9f28e8d4522ed85aac29600e443d1f07a566c89651" as const;
const paymentVerifier = "0x10B2419e526Dc860E85c2315536389FA0D1269DA" as const;

test("reads the completed Phase 6.3 state from Coston2", async () => {
  const data = await readDashboard("0x8E4f5D2736B988D4e922b988FF89bcCde45C6f2f");
  expect(data?.eventConsumed).toBe(true);
  expect(data?.resultConsumed).toBe(true);
  expect(dashboardSelection.eventHash).toBe(completedEventHash);
  expect(contracts.paymentVerifier).toBe(paymentVerifier);
  expect(data?.snapshot?.ruleId).toBe("0x2a3a9591def2b67120f829c342d002de5e2def49ac0f4044a6be143071489400");
  expect(data?.position?.id).toBe(1n);
  expect(data?.position?.totalDeposited).toBe(700_000_000n);
  expect(data?.managerTokenBalance).toBe(0n);
}, 120_000);

test("rejects the malformed Railway event selector instead of reading another state", async () => {
  await expect(publicClient.readContract({
    address: contracts.guardManager,
    abi: guardManagerAbi,
    functionName: "getEvaluationSnapshot",
    args: [productionTypoEventHash],
  })).rejects.toThrow(/revert|EvaluationNotPrepared|not prepared/i);
}, 120_000);
