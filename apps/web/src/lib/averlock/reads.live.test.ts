import { expect, test } from "vitest";
import { readDashboard } from "./reads";

test("reads the completed Phase 6.3 state from Coston2", async () => {
  const data = await readDashboard("0x8E4f5D2736B988D4e922b988FF89bcCde45C6f2f");
  expect(data?.eventConsumed).toBe(true);
  expect(data?.resultConsumed).toBe(true);
  expect(data?.snapshot?.ruleId).toBe("0x2a3a9591def2b67120f829c342d002de5e2def49ac0f4044a6be143071489400");
  expect(data?.position?.id).toBe(1n);
  expect(data?.position?.totalDeposited).toBe(700_000_000n);
  expect(data?.managerTokenBalance).toBe(0n);
}, 120_000);
