const sleep = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

export function requestsPerSecond(value) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) throw new Error("AVERLOCK_RPC_REQUESTS_PER_SECOND must be a positive number");
  return parsed;
}

function retryAfterMilliseconds(value, now = Date.now()) {
  if (!value) return undefined;
  const seconds = Number(value);
  if (Number.isFinite(seconds) && seconds >= 0) return seconds * 1_000;
  const date = Date.parse(value);
  return Number.isNaN(date) ? undefined : Math.max(0, date - now);
}

export function createRateLimitedFetch({ requestsPerSecond, fetchFn = fetch, random = Math.random, onRetry } = {}) {
  const interval = 1_000 / requestsPerSecond;
  let nextRequestAt = 0;
  let blockedUntil = 0;
  let retryingRequests = 0;

  async function acquire() {
    for (;;) {
      const now = Date.now();
      const scheduled = Math.max(now, nextRequestAt, blockedUntil);
      nextRequestAt = scheduled + interval;
      if (scheduled > now) await sleep(scheduled - now);
      // A different in-flight RPC may have received a 429 while this request slept.
      if (Date.now() >= blockedUntil) return;
    }
  }

  async function rateLimitedFetch(...args) {
    let attempt = 0;
    let retrying = false;
    for (;;) {
      await acquire();
      const response = await fetchFn(...args);
      if (response.status !== 429) {
        if (retrying) retryingRequests -= 1;
        return response;
      }

      attempt += 1;
      if (!retrying) { retrying = true; retryingRequests += 1; }
      const retryAfter = retryAfterMilliseconds(response.headers.get("retry-after"));
      const exponential = Math.min(30_000, 500 * 2 ** Math.min(attempt - 1, 6));
      const delay = retryAfter ?? Math.round(exponential * (0.5 + random()));
      blockedUntil = Math.max(blockedUntil, Date.now() + delay);
      nextRequestAt = Math.max(nextRequestAt, blockedUntil);
      onRetry?.({ attempt, delay, retryAfter: retryAfter !== undefined });
    }
  }

  rateLimitedFetch.status = () => ({ retrying: retryingRequests > 0, blockedUntil: retryingRequests > 0 ? blockedUntil : undefined });
  return rateLimitedFetch;
}
