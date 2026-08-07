import { createPublicClient, formatUnits, http, parseAbi, parseAbiItem } from "viem";

const RPC = "https://coston2-api.flare.network/ext/C/rpc";
const ASSET_MANAGER = "0xc1Ca88b937d0b528842F95d5731ffB586f4fbDFA";
const TOKEN = "0x0b6A3645c240605887a5532109323A3E12273dc7";
const RECIPIENT = "0x8E4f5D2736B988D4e922b988FF89bcCde45C6f2f";
const TRANSACTION_ID = "0x0e16edc43a159df1ca34a02b76f8a9420d7f337cf85b098d44319f7eb21d4e82";
const client = createPublicClient({ transport: http(RPC) });
const tokenAbi = parseAbi(["function balanceOf(address) view returns (uint256)"]);
const event = parseAbiItem("event DirectMintingExecuted(bytes32 transactionId,address targetAddress,address executor,uint256 mintedAmountUBA,uint256 mintingFeeUBA,uint256 executorFeeUBA)");
const transferEvent = parseAbiItem("event Transfer(address indexed from,address indexed to,uint256 value)");

const balance = await client.readContract({ address: TOKEN, abi: tokenAbi, functionName: "balanceOf", args: [RECIPIENT] });
let logs = [];
const latest = await client.getBlockNumber();
for (let start = 33_625_000n; start <= latest && logs.length === 0; start += 30n) {
  const end = start + 29n > latest ? latest : start + 29n;
  const candidates = await client.getLogs({ address: ASSET_MANAGER, event, fromBlock: start, toBlock: end });
  logs = candidates.filter((log) => log.args.transactionId?.toLowerCase() === TRANSACTION_ID.toLowerCase());
}
let mintTransfers = [];
for (let start = 33_625_000n; start <= latest && mintTransfers.length === 0; start += 30n) {
  const end = start + 29n > latest ? latest : start + 29n;
  mintTransfers = await client.getLogs({ address: TOKEN, event: transferEvent,
    args: { to: RECIPIENT }, fromBlock: start, toBlock: end });
}
console.log(JSON.stringify({
  recipient: RECIPIENT, balanceUnits: balance.toString(), balanceFTestXRP: formatUnits(balance, 6),
  executions: logs.map((log) => ({ transactionHash: log.transactionHash, blockNumber: log.blockNumber.toString(),
    transactionId: log.args.transactionId, targetAddress: log.args.targetAddress, executor: log.args.executor,
    mintedAmountUBA: log.args.mintedAmountUBA.toString(), mintingFeeUBA: log.args.mintingFeeUBA.toString(),
    executorFeeUBA: log.args.executorFeeUBA.toString() })),
  mintTransfers: mintTransfers.map((log) => ({ transactionHash: log.transactionHash,
    blockNumber: log.blockNumber.toString(), from: log.args.from, value: log.args.value.toString() })),
}, null, 2));
