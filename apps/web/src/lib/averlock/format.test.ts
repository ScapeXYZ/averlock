import { describe, expect, it } from "vitest";
import { compactAddress, formatToken, formatUsd18, formatXrpFromSnapshot } from "./format";

describe("dashboard formatting", () => {
  it("formats token units without inventing precision", () => expect(formatToken(700_145_000n)).toBe("700.145"));
  it("derives XRP from the stored valuation snapshot", () => expect(formatXrpFromSnapshot(1_056_936n * 10n ** 15n, 1_056_936n * 10n ** 12n)).toBe("1,000 XRP"));
  it("formats USD18", () => expect(formatUsd18(739_855_200n * 10n ** 12n, 4)).toBe("$739.8552"));
  it("compacts public identifiers", () => expect(compactAddress("0x1234567890abcdef" as `0x${string}`)).toBe("0x1234…cdef"));
});
