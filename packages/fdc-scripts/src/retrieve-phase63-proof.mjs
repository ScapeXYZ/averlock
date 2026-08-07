import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  createPublicClient, decodeAbiParameters, decodeFunctionData, encodeAbiParameters,
  http, keccak256, parseAbi, parseAbiParameters, stringToHex,
} from "viem";

const RPC = "https://coston2-api.flare.network/ext/C/rpc";
const REGISTRY = "0xaD67FE66660Fb8dFE9d6b1b4240d8650e30F6019";
const FDC_VERIFICATION = "0x906507E0B64bcD494Db73bd0459d1C667e14B933";
const directMint = process.argv.includes("--direct-mint");
const REQUEST_TX = directMint
  ? "0x97a948672fdf1e5b0786e86c609a7a110aa47c739e424c6a04b24cd02e8bea57"
  : "0xb1dd31cca18ae3f0216817045c27258e001579391503b2f6cd9abc626e9f1955";
const EXPECTED_FDC_HUB = "0x48aC463d7975828989331F4De43341627b9c5f1D";
const EXPECTED_XRPL_TX = directMint
  ? "0x0E16EDC43A159DF1CA34A02B76F8A9420D7F337CF85B098D44319F7EB21D4E82"
  : "0x276E4D3C2F6B2D0A9D59293E82C4EB4E32003A6EAAD6945E95D51A1E2C0E603C";
const EXPECTED_PROOF_OWNER = directMint
  ? "0x8E4f5D2736B988D4e922b988FF89bcCde45C6f2f"
  : "0x444947Aaa00aB3fddbeb6421244A160448E6B52D";
const EXPECTED_RECEIVER_HASH = "0x09315be6d53add03ed87dd25dae59f3b774f74b14f0a2c6637c4d1287cc5173c";
const EXPECTED_MEMO_HEX = directMint
  ? "0x4642505266410018000000008e4f5d2736b988d4e922b988ff89bccde45c6f2f"
  : "0x415645524c4f434b5f4532455f56325f303031";
const EXPECTED_TAG = 63001n;
const EXPECTED_DROPS = directMint ? 702_000_000n : 1_000_000_000n;

const packageDirectory = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const requestArtifactPath = path.join(packageDirectory, "data", directMint ? "direct-mint-fdc.local.json" : "phase63-fdc.local.json");
const proofArtifactPath = path.join(packageDirectory, "data", directMint ? "direct-mint-proof.local.json" : "phase63-proof.local.json");
const requestArtifact = JSON.parse(fs.readFileSync(requestArtifactPath, "utf8"));
const client = createPublicClient({ transport: http(RPC) });

const registryAbi = parseAbi(["function getContractAddressByName(string) view returns (address)"]);
const relayAbi = parseAbi([
  "function getVotingRoundId(uint256) view returns (uint256)",
  "function isFinalized(uint256,uint256) view returns (bool)",
]);
const verificationAbi = parseAbi([
  "function fdcProtocolId() view returns (uint8)",
  "function verifyXRPPayment((bytes32[],(bytes32,bytes32,uint64,uint64,(bytes32,address),(uint64,uint64,string,bytes32,bytes32,bytes32,int256,int256,int256,int256,bool,bytes,bool,uint256,uint8)))) view returns (bool)",
]);
const hubAbi = parseAbi(["function requestAttestation(bytes) payable"]);
const responseParameters = parseAbiParameters(
  "(bytes32 attestationType,bytes32 sourceId,uint64 votingRound,uint64 lowestUsedTimestamp,(bytes32 transactionId,address proofOwner) requestBody,(uint64 blockNumber,uint64 blockTimestamp,string sourceAddress,bytes32 sourceAddressHash,bytes32 receivingAddressHash,bytes32 intendedReceivingAddressHash,int256 spentAmount,int256 intendedSpentAmount,int256 receivedAmount,int256 intendedReceivedAmount,bool hasMemoData,bytes firstMemoData,bool hasDestinationTag,uint256 destinationTag,uint8 status) responseBody) response",
);

const receipt = await client.getTransactionReceipt({ hash: REQUEST_TX });
if (receipt.status !== "success" || receipt.to?.toLowerCase() !== EXPECTED_FDC_HUB.toLowerCase()) {
  throw new Error("submitted FDC request receipt mismatch");
}
const transaction = await client.getTransaction({ hash: REQUEST_TX });
const decodedCall = decodeFunctionData({ abi: hubAbi, data: transaction.input });
if (decodedCall.args[0].toLowerCase() !== requestArtifact.abiEncodedRequest.toLowerCase()) {
  throw new Error("onchain request bytes differ from verifier-approved request");
}
const block = await client.getBlock({ blockNumber: receipt.blockNumber });
const relay = await client.readContract({ address: REGISTRY, abi: registryAbi, functionName: "getContractAddressByName", args: ["Relay"] });
const resolvedVerification = await client.readContract({ address: REGISTRY, abi: registryAbi, functionName: "getContractAddressByName", args: ["FdcVerification"] });
if (resolvedVerification.toLowerCase() !== FDC_VERIFICATION.toLowerCase()) throw new Error("FdcVerification registry mismatch");
const protocolId = await client.readContract({ address: FDC_VERIFICATION, abi: verificationAbi, functionName: "fdcProtocolId" });
const votingRound = await client.readContract({ address: relay, abi: relayAbi, functionName: "getVotingRoundId", args: [block.timestamp] });

let finalized = false;
for (let attempt = 0; attempt < 60; attempt += 1) {
  finalized = await client.readContract({ address: relay, abi: relayAbi, functionName: "isFinalized", args: [BigInt(protocolId), votingRound] });
  if (finalized) break;
  await new Promise((resolve) => setTimeout(resolve, 5_000));
}
if (!finalized) throw new Error(`FDC round ${votingRound} did not finalize within polling window`);

const daEndpoint = `${requestArtifact.daLayerUrl}/api/v1/fdc/proof-by-request-round-raw`;
let daProof;
for (let attempt = 0; attempt < 60; attempt += 1) {
  const response = await fetch(daEndpoint, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ votingRoundId: Number(votingRound), requestBytes: requestArtifact.abiEncodedRequest }),
  });
  if (!response.ok) throw new Error(`public DA Layer HTTP ${response.status}`);
  const candidate = await response.json();
  const responseHex = candidate.response_hex ?? candidate.responseHex;
  if (responseHex) {
    daProof = { responseHex, proof: candidate.proof ?? candidate.proofs ?? [], attestationType: candidate.attestation_type ?? candidate.attestationType };
    break;
  }
  await new Promise((resolve) => setTimeout(resolve, 5_000));
}
if (!daProof) throw new Error("public DA Layer did not return the proof within polling window");

const [decoded] = decodeAbiParameters(responseParameters, daProof.responseHex);
const body = decoded.responseBody;
const responseTuple = [
  decoded.attestationType, decoded.sourceId, decoded.votingRound, decoded.lowestUsedTimestamp,
  [decoded.requestBody.transactionId, decoded.requestBody.proofOwner],
  [body.blockNumber, body.blockTimestamp, body.sourceAddress, body.sourceAddressHash, body.receivingAddressHash,
    body.intendedReceivingAddressHash, body.spentAmount, body.intendedSpentAmount, body.receivedAmount,
    body.intendedReceivedAmount, body.hasMemoData, body.firstMemoData, body.hasDestinationTag,
    body.destinationTag, body.status],
];
const proof = [daProof.proof, responseTuple];
const verified = await client.readContract({ address: FDC_VERIFICATION, abi: verificationAbi, functionName: "verifyXRPPayment", args: [proof] });
const expectedAttestation = stringToHex("XRPPayment", { size: 32 });
const expectedSource = stringToHex("testXRP", { size: 32 });
if (!verified || decoded.attestationType !== expectedAttestation || decoded.sourceId !== expectedSource ||
  decoded.requestBody.transactionId.toLowerCase() !== EXPECTED_XRPL_TX.toLowerCase() ||
  decoded.requestBody.proofOwner.toLowerCase() !== EXPECTED_PROOF_OWNER.toLowerCase() ||
  (!directMint && body.receivingAddressHash.toLowerCase() !== EXPECTED_RECEIVER_HASH) || body.receivedAmount !== EXPECTED_DROPS ||
  body.status !== 0 || !body.hasMemoData || body.firstMemoData.toLowerCase() !== EXPECTED_MEMO_HEX ||
  (directMint ? body.hasDestinationTag : (!body.hasDestinationTag || body.destinationTag !== EXPECTED_TAG))) {
  throw new Error("decoded XRPPayment proof does not match the authorized payment");
}

const proofAbi = encodeAbiParameters(parseAbiParameters(
  "(bytes32[] merkleProof,(bytes32 attestationType,bytes32 sourceId,uint64 votingRound,uint64 lowestUsedTimestamp,(bytes32 transactionId,address proofOwner) requestBody,(uint64 blockNumber,uint64 blockTimestamp,string sourceAddress,bytes32 sourceAddressHash,bytes32 receivingAddressHash,bytes32 intendedReceivingAddressHash,int256 spentAmount,int256 intendedSpentAmount,int256 receivedAmount,int256 intendedReceivedAmount,bool hasMemoData,bytes firstMemoData,bool hasDestinationTag,uint256 destinationTag,uint8 status) responseBody) data) proof",
), [proof]);
const artifact = {
  requestTransaction: REQUEST_TX, requestBlock: receipt.blockNumber.toString(), requestBlockTimestamp: block.timestamp.toString(),
  relay, fdcVerification: resolvedVerification, protocolId: Number(protocolId), votingRound: votingRound.toString(), finalized,
  daEndpoint, merkleProof: daProof.proof, responseHex: daProof.responseHex, proofAbi,
  verified,
  decoded: {
    transactionId: decoded.requestBody.transactionId, proofOwner: decoded.requestBody.proofOwner,
    ledgerIndex: body.blockNumber.toString(), paymentTimestamp: body.blockTimestamp.toString(),
    sourceAddress: body.sourceAddress, sourceAddressHash: body.sourceAddressHash,
    receivingAddressHash: body.receivingAddressHash, receivedDrops: body.receivedAmount.toString(),
    spentDrops: body.spentAmount.toString(), status: Number(body.status), memoHex: body.firstMemoData,
    destinationTag: body.destinationTag.toString(),
  },
  responseLeaf: keccak256(daProof.responseHex),
};
fs.writeFileSync(proofArtifactPath, `${JSON.stringify(artifact, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
console.log(JSON.stringify(artifact, null, 2));
