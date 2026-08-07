import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const packageDirectory = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const environmentPath = path.join(packageDirectory, ".env.local");
const artifactPath = path.join(packageDirectory, "data", "phase63-fdc.local.json");
const verifierUrl = "https://fdc-verifiers-testnet.flare.network/verifier/xrp/XRPPayment/prepareRequest";
const transactionId = "0x276E4D3C2F6B2D0A9D59293E82C4EB4E32003A6EAAD6945E95D51A1E2C0E603C";
const proofOwner = "0x444947Aaa00aB3fddbeb6421244A160448E6B52D";
const attestationType = `0x${Buffer.from("XRPPayment").toString("hex").padEnd(64, "0")}`;
const sourceId = `0x${Buffer.from("testXRP").toString("hex").padEnd(64, "0")}`;

function environment() {
  return Object.fromEntries(fs.readFileSync(environmentPath, "utf8").split(/\r?\n/u)
    .filter((line) => line && !line.startsWith("#") && line.includes("="))
    .map((line) => {
      const separator = line.indexOf("=");
      return [line.slice(0, separator), line.slice(separator + 1)];
    }));
}

const env = environment();
if (!env.VERIFIER_API_KEY_TESTNET) throw new Error("VERIFIER_API_KEY_TESTNET is not configured");
if (env.COSTON2_DA_LAYER_URL !== "https://ctn2-data-availability.flare.network") {
  throw new Error("official public Coston2 DA Layer URL is not configured");
}
if (env.X_API_KEY) throw new Error("public DA flow must not silently use an unverified API key");

const response = await fetch(verifierUrl, {
  method: "POST",
  headers: { "Content-Type": "application/json", "X-API-KEY": env.VERIFIER_API_KEY_TESTNET },
  body: JSON.stringify({
    attestationType,
    sourceId,
    requestBody: { transactionId, proofOwner: proofOwner.toLowerCase() },
  }),
});
const data = await response.json();
if (!response.ok) throw new Error(`verifier HTTP ${response.status}: ${data.message ?? "request failed"}`);
if (data.status !== "VALID" || typeof data.abiEncodedRequest !== "string") {
  throw new Error(`verifier did not return VALID: ${JSON.stringify(data)}`);
}
const encoded = data.abiEncodedRequest.toLowerCase();
for (const expected of [attestationType, sourceId, transactionId, proofOwner]) {
  if (!encoded.includes(expected.toLowerCase().slice(2))) throw new Error(`encoded request missing ${expected}`);
}

fs.mkdirSync(path.dirname(artifactPath), { recursive: true });
const artifact = {
  verifierStatus: data.status,
  verifierUrl,
  daLayerUrl: env.COSTON2_DA_LAYER_URL,
  attestationType,
  sourceId,
  transactionId,
  proofOwner,
  abiEncodedRequest: data.abiEncodedRequest,
};
fs.writeFileSync(artifactPath, `${JSON.stringify(artifact, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
console.log(JSON.stringify(artifact, null, 2));
