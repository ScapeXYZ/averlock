import { formatUnits, type Address, type Hex } from "viem";

export function compactAddress(value?: Address | Hex, start = 6, end = 4) {
  if (!value) return "—";
  return `${value.slice(0, start)}…${value.slice(-end)}`;
}

export function formatToken(value: bigint, decimals = 6, maximumFractionDigits = 4) {
  return new Intl.NumberFormat("en-US", { maximumFractionDigits }).format(Number(formatUnits(value, decimals)));
}

export function formatUsd18(value: bigint, maximumFractionDigits = 2) {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits }).format(Number(formatUnits(value, 18)));
}

export function formatXrpFromSnapshot(eventValueUsd18: bigint, priceUsd18: bigint) {
  if (priceUsd18 === 0n) return "—";
  const xrp18 = eventValueUsd18 * 10n ** 18n / priceUsd18;
  return `${new Intl.NumberFormat("en-US", { maximumFractionDigits: 3 }).format(Number(formatUnits(xrp18, 18)))} XRP`;
}

export function formatDate(timestamp: bigint) {
  if (!timestamp) return "—";
  return new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit" }).format(Number(timestamp) * 1000);
}

export function relativeUnlock(end: bigint, now = BigInt(Math.floor(Date.now() / 1000))) {
  if (end <= now) return "Fully released";
  const days = Number(end - now) / 86_400;
  return `${Math.max(1, Math.ceil(days))} days remaining`;
}
