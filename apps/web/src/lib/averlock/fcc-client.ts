import type { Address, Hex } from "viem";
import type { PreparedPolicy } from "./validation";

export type PreparedEnvelope = { ruleId: Hex; policyCommitment: Hex; encryptedEnvelope: Hex; tee: Address; extensionId: string };
export type VerifiedPolicyResult = { accepted: true; ruleId: Hex; policyCommitment: Hex; actionId: Hex; signatureValid: true };
export type ConfidentialVerificationStatus = "NOT_REQUIRED" | "PENDING" | "VERIFIED" | "FAILED" | "FCC_UNAVAILABLE";
export type ConfidentialVerification<T> = { status: ConfidentialVerificationStatus; result?: T; error?: string };

export async function preparePrivatePolicy(policy: PreparedPolicy): Promise<PreparedEnvelope> {
  const response = await fetch("/api/averlock/fcc/policy", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ policy }), cache: "no-store" });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || "Private policy preparation failed.");
  return result;
}

/** FCC implementation boundary. Nothing outside this adapter needs tee-proxy details. */
export async function requestConfidentialVerification(policy: PreparedPolicy): Promise<ConfidentialVerification<PreparedEnvelope>> {
  try { return { status: "PENDING", result: await preparePrivatePolicy(policy) }; }
  catch (error) { return { status: "FCC_UNAVAILABLE", error: error instanceof Error ? error.message : "FCC is unavailable." }; }
}

export async function waitForPolicyResult(actionId: Hex, ruleId: Hex, commitment: Hex, timeoutMs = 120_000): Promise<VerifiedPolicyResult> {
  const deadline = Date.now() + timeoutMs;
  const url = `/api/averlock/fcc/result/${actionId}?ruleId=${ruleId}&commitment=${commitment}`;
  while (Date.now() < deadline) {
    const response = await fetch(url, { cache: "no-store" });
    const result = await response.json();
    if (response.ok && !result.pending) return result;
    if (response.status !== 202) throw new Error(result.error || "FCC rejected the private policy.");
    await new Promise((resolve) => setTimeout(resolve, 2_000));
  }
  throw new Error("The FCC policy result is still pending. The submitted transaction is safe to inspect before retrying verification.");
}

export async function getConfidentialVerificationResult(actionId: Hex, ruleId: Hex, commitment: Hex): Promise<ConfidentialVerification<VerifiedPolicyResult>> {
  try { return { status: "VERIFIED", result: await waitForPolicyResult(actionId, ruleId, commitment) }; }
  catch (error) {
    const message = error instanceof Error ? error.message : "FCC result verification failed.";
    return { status: /temporarily unavailable|unavailable/i.test(message) ? "FCC_UNAVAILABLE" : "FAILED", error: message };
  }
}
