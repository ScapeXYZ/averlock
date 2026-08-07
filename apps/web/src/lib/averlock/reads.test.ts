import { describe, expect, it, vi } from "vitest";
import { dashboardReadDiagnostics } from "./reads";

describe("optional dashboard reads", () => {
  it("isolates an optional RPC failure instead of rejecting core state", async () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);
    await expect(dashboardReadDiagnostics.optional("optional feed", async () => { throw new Error("RPC unavailable"); })).resolves.toBeUndefined();
    expect(consoleError).toHaveBeenCalledOnce();
    consoleError.mockRestore();
  });
});
