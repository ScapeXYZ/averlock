export type LiveDependency = "RPC_UNAVAILABLE" | "WRONG_NETWORK" | "CONTRACT_UNAVAILABLE" | "FTSO_UNAVAILABLE" | "FDC_UNAVAILABLE" | "FCC_UNAVAILABLE";

const dependencyMessages: Record<LiveDependency, string> = {
  RPC_UNAVAILABLE: "Coston2 RPC is unavailable. No verified values were replaced with fallback data.",
  WRONG_NETWORK: "A live dependency is configured for the wrong network. Coston2 (chain ID 114) is required.",
  CONTRACT_UNAVAILABLE: "A required AVERLOCK contract is unavailable on Coston2. No guard was created.",
  FTSO_UNAVAILABLE: "The live FTSO XRP/USD price is unavailable. No value was fabricated.",
  FDC_UNAVAILABLE: "The live FDC payment-verification data is unavailable. No payment was accepted.",
  FCC_UNAVAILABLE: "The confidential verification service is unavailable. No guard state was changed.",
};

export function liveDependencyError(code: LiveDependency) { return new Error(`AVERLOCK_DEPENDENCY:${code}`); }
export function liveDependencyCode(error: unknown): LiveDependency | undefined {
  const match = error instanceof Error ? error.message.match(/AVERLOCK_DEPENDENCY:(RPC_UNAVAILABLE|WRONG_NETWORK|CONTRACT_UNAVAILABLE|FTSO_UNAVAILABLE|FDC_UNAVAILABLE|FCC_UNAVAILABLE)/) : undefined;
  return match?.[1] as LiveDependency | undefined;
}
export function liveDependencyMessage(code: LiveDependency) { return dependencyMessages[code]; }

export function devError(scope: string, error: unknown) {
  if (process.env.NODE_ENV !== "production") console.error(`[AVERLOCK ${scope}]`, error);
}

export function userFacingError(error: unknown, fallback: string) {
  const code = liveDependencyCode(error); if (code) return liveDependencyMessage(code);
  const message = error instanceof Error ? error.message : ""; const lower = message.toLowerCase();
  if (/user rejected|user denied|rejected the request/.test(lower)) return "The wallet request was declined. No transaction was sent.";
  if (/wrong chain|wrong network|chain.*mismatch/.test(lower)) return "Coston2 is required. Switch to chain ID 114 and try again.";
  if (/getxrpusdpriceusd18|ftso|price reader/.test(lower)) return dependencyMessages.FTSO_UNAVAILABLE;
  if (/fdc|xrpl.*verifier|verifyxrppayment|requestattestation/.test(lower)) return dependencyMessages.FDC_UNAVAILABLE;
  if (/contract.*(not found|unavailable)|no contract code/.test(lower)) return dependencyMessages.CONTRACT_UNAVAILABLE;
  if (/binding mismatch|does not match|required onchain state|invalidtee|invalid.*signature|domain mismatch/.test(lower)) return "Security verification stopped: the public contract bindings did not match.";
  if (/fcc|tee|action result|policy processing/.test(lower)) return "The confidential verification service is temporarily unavailable. No guard state was changed.";
  if (/insufficient funds|allowance|balance/.test(lower)) return "The wallet does not have enough balance or allowance for this action.";
  if (/revert|execution reverted|transaction failed/.test(lower)) return "The transaction simulation or confirmation failed. No success state has been assumed.";
  if (/fetch|network|rpc|timeout|timed out|failed to read|unavailable/.test(lower)) return "Live Coston2 data is temporarily unavailable. Verified values have not been replaced with fallback data.";
  return fallback;
}
