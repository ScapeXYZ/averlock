import { describe, expect, it } from "vitest";
import { liveDependencyCode, liveDependencyError, userFacingError } from "./errors";

describe("live dependency errors", () => {
  it("keeps named dependency failures fail-closed and distinct", () => {
    const error = liveDependencyError("FTSO_UNAVAILABLE");
    expect(liveDependencyCode(error)).toBe("FTSO_UNAVAILABLE");
    expect(userFacingError(error, "fallback")).toContain("FTSO XRP/USD");
  });

  it("labels FDC and contract failures without falling back", () => {
    expect(userFacingError(new Error("verifyXRPPayment failed"), "fallback")).toContain("FDC");
    expect(userFacingError(new Error("no contract code at address"), "fallback")).toContain("AVERLOCK contract");
  });
});
