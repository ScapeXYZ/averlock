import { isAddress, keccak256, parseUnits, stringToHex, type Address, type Hex } from "viem";

export type GuardForm = {
  xrplDestination: string; thresholdUsd: string; protectPercent: string; maxPerEventUsd: string;
  cooldownSeconds: string; expiresAt: string; scheduleId: 1;
};

export type PreparedPolicy = {
  ruleId: Hex; thresholdUsd18: string; protectBps: number; scheduleId: number;
  maxPerEventUsd18: string; cooldownSeconds: number; expiresAt: number;
};

export type ValidationErrors = Partial<Record<keyof GuardForm | "wallet", string>>;

export function isValidXrplClassicAddress(value: string) {
  return /^r[1-9A-HJ-NP-Za-km-z]{24,34}$/.test(value.trim());
}

export function receiverHash(address: string): Hex {
  if (!isValidXrplClassicAddress(address)) throw new Error("Enter a valid XRPL classic address beginning with r.");
  return keccak256(stringToHex(address.trim()));
}

export function validateGuardForm(form: GuardForm, wallet?: Address): ValidationErrors {
  const errors: ValidationErrors = {};
  if (!wallet || !isAddress(wallet)) errors.wallet = "Connect the Coston2 wallet that will own this guard.";
  if (!isValidXrplClassicAddress(form.xrplDestination)) errors.xrplDestination = "Enter a valid XRPL classic destination address beginning with r.";
  let threshold = 0n, maximum = 0n;
  try { threshold = parseUnits(form.thresholdUsd, 18); if (threshold <= 0n) throw new Error(); } catch { errors.thresholdUsd = "Threshold must be a positive USD amount."; }
  const percentage = Number(form.protectPercent);
  if (!Number.isFinite(percentage) || percentage <= 0 || percentage > 100 || !/^\d+(\.\d{1,2})?$/.test(form.protectPercent)) errors.protectPercent = "Choose a percentage from 0.01% to 100%, with at most two decimals.";
  try { maximum = form.maxPerEventUsd.trim() ? parseUnits(form.maxPerEventUsd, 18) : 0n; if (maximum < 0n) throw new Error(); } catch { errors.maxPerEventUsd = "Maximum must be zero, blank, or a valid USD amount."; }
  if (!errors.thresholdUsd && !errors.maxPerEventUsd && maximum > 0n && maximum < threshold) errors.maxPerEventUsd = "Maximum must be at least the trigger threshold.";
  const cooldown = Number(form.cooldownSeconds);
  if (!Number.isSafeInteger(cooldown) || cooldown < 0) errors.cooldownSeconds = "Cooldown must be a non-negative whole number of seconds.";
  const expiry = Math.floor(new Date(form.expiresAt).getTime() / 1000);
  if (!Number.isSafeInteger(expiry) || expiry <= Math.floor(Date.now() / 1000) + 300) errors.expiresAt = "Policy expiry must be at least five minutes in the future.";
  return errors;
}

export function buildPolicy(form: GuardForm, ruleId: Hex): PreparedPolicy {
  const errors = validateGuardForm(form, "0x0000000000000000000000000000000000000001");
  if (Object.keys(errors).length) throw new Error(Object.values(errors)[0]);
  return {
    ruleId, thresholdUsd18: parseUnits(form.thresholdUsd, 18).toString(), protectBps: Math.round(Number(form.protectPercent) * 100),
    scheduleId: 1, maxPerEventUsd18: form.maxPerEventUsd.trim() ? parseUnits(form.maxPerEventUsd, 18).toString() : "0",
    cooldownSeconds: Number(form.cooldownSeconds), expiresAt: Math.floor(new Date(form.expiresAt).getTime() / 1000),
  };
}

export function containsPrivatePolicyKeys(value: unknown) {
  const text = JSON.stringify(value);
  return ["thresholdUsd18", "protectBps", "maxPerEventUsd18", "cooldownSeconds", "expiresAt"].some((key) => text.includes(key));
}
