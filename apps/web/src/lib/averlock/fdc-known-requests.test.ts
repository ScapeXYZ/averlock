import { describe, expect, it } from "vitest";
import { knownRequestTransactionForPayment } from "./fdc-known-requests";

const paymentHash = "E5FB282252B497FD74EDDAC2D2D66D93478C2C5575F1BE5DEF861CF9C61D5872";
const successfulRequest = "0x1079984dd49c1be9e26f82b21301cd458b3f6f56c398be4c8d20dc8f0db4a12e";

describe("known FDC requests", () => {
  it("reuses the finalized request for the exact XRP payment without creating a new request", () => {
    expect(knownRequestTransactionForPayment(paymentHash)).toBe(successfulRequest);
    expect(knownRequestTransactionForPayment(paymentHash.toLowerCase())).toBe(successfulRequest);
  });

  it("preserves the existing known request mapping", () => {
    expect(knownRequestTransactionForPayment("56CA82B41FD8112BAC53EE24DB60B27A11A4D5C9B58D75808B485C8435CB19DF")).toBe("0x3fb3b090c03929865627a1125ec28f84bea63761bde3cb60f323af592d6ca29c");
  });
});
