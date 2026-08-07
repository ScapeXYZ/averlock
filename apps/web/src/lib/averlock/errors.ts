export function devError(scope: string, error: unknown) {
  if (process.env.NODE_ENV !== "production") console.error(`[AVERLOCK ${scope}]`, error);
}

export function userFacingError(error: unknown, fallback: string) {
  const message = error instanceof Error ? error.message : ""; const lower = message.toLowerCase();
  if (/user rejected|user denied|rejected the request/.test(lower)) return "The wallet request was declined. No transaction was sent.";
  if (/wrong chain|wrong network|chain.*mismatch/.test(lower)) return "Coston2 is required. Switch to chain ID 114 and try again.";
  if (/binding mismatch|does not match|required onchain state|invalidtee|invalid.*signature|domain mismatch/.test(lower)) return "Security verification stopped: the public contract bindings did not match.";
  if (/fcc|tee|action result|policy processing/.test(lower)) return "The confidential verification service is temporarily unavailable. No guard state was changed.";
  if (/insufficient funds|allowance|balance/.test(lower)) return "The wallet does not have enough balance or allowance for this action.";
  if (/revert|execution reverted|transaction failed/.test(lower)) return "The transaction simulation or confirmation failed. No success state has been assumed.";
  if (/fetch|network|rpc|timeout|timed out|failed to read|unavailable/.test(lower)) return "Live Coston2 data is temporarily unavailable. Verified values have not been replaced with fallback data.";
  return fallback;
}
