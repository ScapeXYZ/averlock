import { describe, expect, it } from "vitest";
import { buildPolicy, containsPrivatePolicyKeys, receiverHash, validateGuardForm, type GuardForm } from "./validation";
import { guardIndexContainsPrivateData, type GuardIndexEntry } from "./guard-index";

const wallet = "0x8E4f5D2736B988D4e922b988FF89bcCde45C6f2f" as const;
const ruleId = `0x${"12".repeat(32)}` as const;
const form = (): GuardForm => ({ xrplDestination: "rSAJ3aWFJoFoqk19kKiYZ2mtsnLAJLjKG", thresholdUsd: "1000", protectPercent: "70", maxPerEventUsd: "10000", cooldownSeconds: "60", expiresAt: new Date(Date.now() + 86_400_000).toISOString().slice(0, 16), scheduleId: 1 });

describe("Create Guard validation", () => {
  it("constructs the exact supported private policy payload", () => {
    expect(buildPolicy(form(), ruleId)).toMatchObject({ ruleId, thresholdUsd18: "1000000000000000000000", protectBps: 7000, scheduleId: 1, maxPerEventUsd18: "10000000000000000000000", cooldownSeconds: 60 });
  });
  it("rejects invalid XRPL destinations and disconnected wallets", () => {
    const invalid = { ...form(), xrplDestination: "not-xrpl" };
    expect(validateGuardForm(invalid)).toMatchObject({ wallet: expect.any(String), xrplDestination: expect.any(String) });
    expect(() => receiverHash(invalid.xrplDestination)).toThrow(/valid XRPL/);
  });
  it("rejects unsafe policy ranges", () => {
    expect(validateGuardForm({ ...form(), protectPercent: "100.01", maxPerEventUsd: "999" }, wallet)).toMatchObject({ protectPercent: expect.any(String), maxPerEventUsd: expect.any(String) });
  });
  it("keeps private terms out of the receipt-backed guard index", () => {
    const entry: GuardIndexEntry = { ruleId, owner: wallet, registrationBlock: "1", transactionHash: `0x${"34".repeat(32)}` };
    expect(guardIndexContainsPrivateData(entry)).toBe(false);
    expect(containsPrivatePolicyKeys(entry)).toBe(false);
  });
});
