import "server-only";
import fs from "node:fs";
import path from "node:path";
import { decodeAbiParameters, decodeFunctionData, getAddress, parseAbi, parseAbiParameters, stringToHex, type Address, type Hex } from "viem";
import { contracts, publicClient } from "./config";
import { guardManagerAbi } from "./contracts";
import { validateXrplPayment } from "./xrpl-payment";
import type { GuardRecord } from "./types";

export const FDC_HUB = "0x48aC463d7975828989331F4De43341627b9c5f1D" as Address;
const REGISTRY = "0xaD67FE66660Fb8dFE9d6b1b4240d8650e30F6019" as Address;
const FDC_VERIFICATION = "0x906507E0B64bcD494Db73bd0459d1C667e14B933" as Address;
const VERIFIER = "https://fdc-verifiers-testnet.flare.network/verifier/xrp/XRPPayment/prepareRequest";
const DA = "https://ctn2-data-availability.flare.network/api/v1/fdc/proof-by-request-round-raw";
const XRPL_RPC = "https://s.altnet.rippletest.net:51234/";
const knownRequests: Record<string, Hex> = { "56ca82b41fd8112bac53ee24db60b27a11a4d5c9b58d75808b485c8435cb19df": "0x3fb3b090c03929865627a1125ec28f84bea63761bde3cb60f323af592d6ca29c" };
const hubAbi = parseAbi(["function requestAttestation(bytes data) payable", "function fdcRequestFeeConfigurations() view returns (address)"]);
const feeAbi = parseAbi(["function getRequestFee(bytes data) view returns (uint256)"]);
const registryAbi = parseAbi(["function getContractAddressByName(string name) view returns (address)"]);
const relayAbi = parseAbi(["function getVotingRoundId(uint256 timestamp) view returns (uint256)", "function isFinalized(uint256 protocolId,uint256 votingRound) view returns (bool)"]);
const verificationAbi = parseAbi(["function fdcProtocolId() view returns (uint8)", "function verifyXRPPayment((bytes32[],(bytes32,bytes32,uint64,uint64,(bytes32,address),(uint64,uint64,string,bytes32,bytes32,bytes32,int256,int256,int256,int256,bool,bytes,bool,uint256,uint8)))) view returns (bool)"]);
const responseParameters = parseAbiParameters("(bytes32 attestationType,bytes32 sourceId,uint64 votingRound,uint64 lowestUsedTimestamp,(bytes32 transactionId,address proofOwner) requestBody,(uint64 blockNumber,uint64 blockTimestamp,string sourceAddress,bytes32 sourceAddressHash,bytes32 receivingAddressHash,bytes32 intendedReceivingAddressHash,int256 spentAmount,int256 intendedSpentAmount,int256 receivedAmount,int256 intendedReceivedAmount,bool hasMemoData,bytes firstMemoData,bool hasDestinationTag,uint256 destinationTag,uint8 status) responseBody) response");

function verifierKey() {
  if (process.env.VERIFIER_API_KEY_TESTNET) return process.env.VERIFIER_API_KEY_TESTNET;
  const file = path.resolve(process.cwd(), "../../packages/fdc-scripts/.env.local");
  if (!fs.existsSync(file)) throw new Error("FDC verifier is not configured.");
  const line = fs.readFileSync(file, "utf8").split(/\r?\n/).find((value) => value.startsWith("VERIFIER_API_KEY_TESTNET="));
  const key = line?.slice(line.indexOf("=") + 1); if (!key) throw new Error("FDC verifier is not configured."); return key;
}
export async function prepareFdc(ruleId: Hex, txHash: string) {
  const guard = await publicClient.readContract({ address: contracts.guardManager, abi: guardManagerAbi, functionName: "getGuard", args: [ruleId] }) as GuardRecord;
  const xrplResponse = await fetch(XRPL_RPC, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ method: "tx", params: [{ transaction: txHash.toUpperCase(), binary: false }] }), cache: "no-store", signal: AbortSignal.timeout(12_000) });
  const xrplJson = await xrplResponse.json(); if (!xrplResponse.ok || xrplJson.result?.error) throw new Error("XRPL Testnet transaction was not found.");
  const payment = validateXrplPayment(xrplJson.result, txHash, guard.monitoredReceiverHash);
  const attestationType = stringToHex("XRPPayment", { size: 32 }); const sourceId = stringToHex("testXRP", { size: 32 });
  const verifier = await fetch(VERIFIER, { method: "POST", headers: { "Content-Type": "application/json", "X-API-KEY": verifierKey() }, body: JSON.stringify({ attestationType, sourceId, requestBody: { transactionId: `0x${payment.hash}`, proofOwner: contracts.guardManager.toLowerCase() } }), cache: "no-store", signal: AbortSignal.timeout(15_000) });
  const prepared = await verifier.json(); if (!verifier.ok || prepared.status !== "VALID" || typeof prepared.abiEncodedRequest !== "string") throw new Error("Flare verifier rejected this XRPL payment.");
  const feeConfig = await publicClient.readContract({ address: FDC_HUB, abi: hubAbi, functionName: "fdcRequestFeeConfigurations" });
  const requestFee = await publicClient.readContract({ address: feeConfig, abi: feeAbi, functionName: "getRequestFee", args: [prepared.abiEncodedRequest] });
  return { payment, ruleId, abiEncodedRequest: prepared.abiEncodedRequest as Hex, requestFee: requestFee.toString(), fdcHub: FDC_HUB, knownRequestTransaction: knownRequests[payment.hash.toLowerCase()] };
}
export async function retrieveFdcProof(abiEncodedRequest: Hex, requestTransaction: Hex) {
  const [receipt, transaction] = await Promise.all([publicClient.getTransactionReceipt({ hash: requestTransaction }), publicClient.getTransaction({ hash: requestTransaction })]);
  if (receipt.status !== "success" || getAddress(receipt.to!) !== getAddress(FDC_HUB)) throw new Error("FDC request receipt binding mismatch.");
  const decodedCall = decodeFunctionData({ abi: hubAbi, data: transaction.input }); if ((decodedCall.args[0] as Hex).toLowerCase() !== abiEncodedRequest.toLowerCase()) throw new Error("FDC request bytes mismatch.");
  const block = await publicClient.getBlock({ blockNumber: receipt.blockNumber });
  const [relay, protocolId] = await Promise.all([publicClient.readContract({ address: REGISTRY, abi: registryAbi, functionName: "getContractAddressByName", args: ["Relay"] }), publicClient.readContract({ address: FDC_VERIFICATION, abi: verificationAbi, functionName: "fdcProtocolId" })]);
  const votingRound = await publicClient.readContract({ address: relay, abi: relayAbi, functionName: "getVotingRoundId", args: [block.timestamp] });
  const finalized = await publicClient.readContract({ address: relay, abi: relayAbi, functionName: "isFinalized", args: [BigInt(protocolId), votingRound] });
  if (!finalized) return { finalized: false, votingRound: votingRound.toString() };
  const da = await fetch(DA, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ votingRoundId: Number(votingRound), requestBytes: abiEncodedRequest }), cache: "no-store", signal: AbortSignal.timeout(15_000) });
  const value = await da.json(); const responseHex = (value.response_hex || value.responseHex) as Hex | undefined; const merkleProof = (value.proof || value.proofs) as Hex[] | undefined;
  if (!da.ok || !responseHex || !merkleProof) return { finalized: true, proofAvailable: false, votingRound: votingRound.toString() };
  const [data] = decodeAbiParameters(responseParameters, responseHex); const body=data.responseBody; const proof = [merkleProof,[data.attestationType,data.sourceId,data.votingRound,data.lowestUsedTimestamp,[data.requestBody.transactionId,data.requestBody.proofOwner],[body.blockNumber,body.blockTimestamp,body.sourceAddress,body.sourceAddressHash,body.receivingAddressHash,body.intendedReceivingAddressHash,body.spentAmount,body.intendedSpentAmount,body.receivedAmount,body.intendedReceivedAmount,body.hasMemoData,body.firstMemoData,body.hasDestinationTag,body.destinationTag,body.status]]] as const;
  const verified = await publicClient.readContract({ address: FDC_VERIFICATION, abi: verificationAbi, functionName: "verifyXRPPayment", args: [proof] });
  if (!verified || getAddress(data.requestBody.proofOwner) !== getAddress(contracts.guardManager) || data.responseBody.status !== 0) throw new Error("FDC proof verification failed closed.");
  return { finalized: true, proofAvailable: true, votingRound: votingRound.toString(), verified: true, proof: JSON.parse(JSON.stringify(proof, (_, item) => typeof item === "bigint" ? item.toString() : item)), transactionId: data.requestBody.transactionId, receivingAddressHash: data.responseBody.receivingAddressHash, receivedDrops: data.responseBody.receivedAmount.toString(), paymentTimestamp: data.responseBody.blockTimestamp.toString() };
}
