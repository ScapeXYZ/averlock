import "server-only";
import { spawn } from "node:child_process";
import path from "node:path";
import { publicKeyToAddress } from "viem/accounts";
import { contracts, fccConfig, publicClient } from "./config";
import { teeManagerAbi } from "./contracts";
import type { Address, Hex } from "viem";

type TeeInfo = { teeInfo: { chainId: number; publicKey: { x: Hex; y: Hex } }; machineData: { extensionId: Hex; publicKey: { x: Hex; y: Hex } } };

function requiredProductionUrl(name: "AVERLOCK_FCC_PROXY_URL" | "AVERLOCK_FCC_RESULT_PROXY_URL", developmentFallback: string) {
  const value = process.env[name];
  if (value) return value;
  if (process.env.NODE_ENV === "production") throw new Error(`${name} is required in production.`);
  return developmentFallback;
}

export async function verifiedLiveTee() {
  const publicProxyUrl = requiredProductionUrl("AVERLOCK_FCC_PROXY_URL", "https://crescentoid-earless-kelsi.ngrok-free.dev");
  const response = await fetch(`${publicProxyUrl.replace(/\/$/, "")}/info`, { cache: "no-store", signal: AbortSignal.timeout(12_000) });
  if (!response.ok) throw new Error("FCC proxy information is unavailable.");
  const info = await response.json() as TeeInfo;
  if (info.teeInfo.chainId !== 114 || BigInt(info.machineData.extensionId) !== fccConfig.extensionId) throw new Error("FCC proxy is configured for the wrong chain or extension.");
  if (info.teeInfo.publicKey.x !== info.machineData.publicKey.x || info.teeInfo.publicKey.y !== info.machineData.publicKey.y) throw new Error("FCC TEE public key mismatch.");
  const publicKey = `0x04${info.teeInfo.publicKey.x.slice(2)}${info.teeInfo.publicKey.y.slice(2)}` as Hex;
  const tee = publicKeyToAddress(publicKey);
  const [machine, status, extensionId] = await Promise.all([
    publicClient.readContract({ address: contracts.teeManager, abi: teeManagerAbi, functionName: "getTeeMachine", args: [tee] }),
    publicClient.readContract({ address: contracts.teeManager, abi: teeManagerAbi, functionName: "getTeeMachineStatus", args: [tee] }),
    publicClient.readContract({ address: contracts.teeManager, abi: teeManagerAbi, functionName: "getExtensionId", args: [tee] }),
  ]);
  if (machine.teeId.toLowerCase() !== tee.toLowerCase() || status !== 2 || extensionId !== fccConfig.extensionId || machine.url.replace(/\/$/, "") !== publicProxyUrl.replace(/\/$/, "")) throw new Error("FCC TEE is not the registered PRODUCTION machine for this extension.");
  return { tee, publicKey: info.teeInfo.publicKey, machine };
}

export async function runPolicyHelper(mode: "prepare" | "verify" | "verify-evaluation", input: unknown) {
  const cwd = path.resolve(process.cwd(), "../../packages/fcc-extension/tools");
  const packagedHelper = process.env.AVERLOCK_POLICY_HELPER_PATH;
  return new Promise<Record<string, unknown>>((resolve, reject) => {
    const child = packagedHelper
      ? spawn(packagedHelper, [mode], { stdio: ["pipe", "pipe", "pipe"], windowsHide: true })
      : spawn("go", ["run", "./cmd/policy-app-helper", mode], { cwd, stdio: ["pipe", "pipe", "pipe"], windowsHide: true });
    let stdout = "", stderr = "";
    child.stdout.setEncoding("utf8").on("data", (chunk) => { stdout += chunk; });
    child.stderr.setEncoding("utf8").on("data", (chunk) => { stderr += chunk; });
    child.once("error", () => reject(new Error("FCC policy helper could not start.")));
    child.once("close", (code) => {
      if (code !== 0) return reject(new Error(process.env.NODE_ENV === "development" ? `FCC policy helper rejected the request: ${stderr.trim()}` : "FCC policy preparation failed."));
      try { resolve(JSON.parse(stdout)); } catch { reject(new Error("FCC policy helper returned invalid output.")); }
    });
    child.stdin.end(JSON.stringify(input));
  });
}

export async function fetchActionResult(actionId: Hex) {
  const base = requiredProductionUrl("AVERLOCK_FCC_RESULT_PROXY_URL", "http://127.0.0.1:6674");
  return fetch(`${base.replace(/\/$/, "")}/action/result/${actionId.slice(2)}?submissionTag=threshold`, { cache: "no-store", signal: AbortSignal.timeout(10_000) });
}

export type VerifiedTee = Awaited<ReturnType<typeof verifiedLiveTee>> & { tee: Address };
