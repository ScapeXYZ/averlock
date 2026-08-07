import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const packageDirectory = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const environmentPath = path.join(packageDirectory, ".env.local");
const artifactPath = path.join(packageDirectory, "data", "direct-mint-fdc.local.json");
const verifierUrl = "https://fdc-verifiers-testnet.flare.network/verifier/xrp/XRPPayment/prepareRequest";
const transactionId = "0x0E16EDC43A159DF1CA34A02B76F8A9420D7F337CF85B098D44319F7EB21D4E82";
const proofOwner = "0x8E4f5D2736B988D4e922b988FF89bcCde45C6f2f";
const attestationType = `0x${Buffer.from("XRPPayment").toString("hex").padEnd(64, "0")}`;
const sourceId = `0x${Buffer.from("testXRP").toString("hex").padEnd(64, "0")}`;

const env = Object.fromEntries(fs.readFileSync(environmentPath, "utf8").split(/\r?\n/u)
  .filter((line) => line && !line.startsWith("#") && line.includes("="))
  .map((line) => [line.slice(0, line.indexOf("=")), line.slice(line.indexOf("=") + 1)]));
if (!env.VERIFIER_API_KEY_TESTNET) throw new Error("VERIFIER_API_KEY_TESTNET is not configured");
if (env.COSTON2_DA_LAYER_URL !== "https://ctn2-data-availability.flare.network") {
  throw new Error("official public Coston2 DA Layer URL is not configured");
}
if (env.X_API_KEY) throw new Error("public DA flow must not use an unverified API key");

const response = await fetch(verifierUrl, {
  method: "POST",
  headers: { "Content-Type": "application/json", "X-API-KEY": env.VERIFIER_API_KEY_TESTNET },
  body: JSON.stringify({ attestationType, sourceId, requestBody: { transactionId, proofOwner: proofOwner.toLowerCase() } }),
});
const data = await response.json();
if (!response.ok) throw new Error(`verifier HTTP ${response.status}: ${data.message ?? "request failed"}`);
if (data.status !== "VALID" || typeof data.abiEncodedRequest !== "string") throw new Error("verifier did not return VALID");
const encoded = data.abiEncodedRequest.toLowerCase();
for (const expected of [attestationType, sourceId, transactionId, proofOwner]) {
  if (!encoded.includes(expected.toLowerCase().slice(2))) throw new Error(`encoded request missing ${expected}`);
}
const artifact = { verifierStatus: data.status, verifierUrl, daLayerUrl: env.COSTON2_DA_LAYER_URL,
  attestationType, sourceId, transactionId, proofOwner, abiEncodedRequest: data.abiEncodedRequest };
fs.mkdirSync(path.dirname(artifactPath), { recursive: true });
fs.writeFileSync(artifactPath, `${JSON.stringify(artifact, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
console.log(JSON.stringify({ ...artifact, abiEncodedRequest: `${data.abiEncodedRequest.slice(0, 42)}...` }, null, 2));
