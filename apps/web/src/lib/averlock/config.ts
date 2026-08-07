import { createPublicClient, defineChain, http, type Address, type Hex } from "viem";
import { createConfig } from "wagmi";
import { injected } from "wagmi/connectors";

const publicAddress = (value: string | undefined, fallback: Address) => (value || fallback) as Address;

export const coston2 = defineChain({
  id: 114,
  name: "Coston2",
  nativeCurrency: { name: "Coston2 Flare", symbol: "C2FLR", decimals: 18 },
  rpcUrls: { default: { http: [process.env.NEXT_PUBLIC_FLARE_RPC_URL || "https://coston2-api.flare.network/ext/C/rpc"] } },
  blockExplorers: { default: { name: "Coston2 Explorer", url: "https://coston2-explorer.flare.network" } },
  testnet: true,
});

export const contracts = {
  guardManager: publicAddress(process.env.NEXT_PUBLIC_AVERLOCK_GUARD_MANAGER, "0x444947Aaa00aB3fddbeb6421244A160448E6B52D"),
  protectionVault: publicAddress(process.env.NEXT_PUBLIC_AVERLOCK_PROTECTION_VAULT, "0xCcF6D8A6AA0F3799f6c9c6069289D4013aABF4Eb"),
  priceReader: publicAddress(process.env.NEXT_PUBLIC_AVERLOCK_PRICE_READER, "0xf2F2bf463b0765729189DeBe4E22dCEd601A18d5"),
  // These are immutable Coston2 deployment bindings. Keeping them in source prevents a
  // stale NEXT_PUBLIC build argument from silently changing a security-critical read.
  paymentVerifier: "0x10B2419e526Dc860E85c2315536389FA0D1269DA" as Address,
  ftestXrp: publicAddress(process.env.NEXT_PUBLIC_AVERLOCK_FTEST_XRP, "0x0b6A3645c240605887a5532109323A3E12273dc7"),
  teeManager: publicAddress(process.env.NEXT_PUBLIC_FLARE_TEE_MANAGER, "0x1a9C4A0f9D76c0b1D91d22E24E573a9b377618aE"),
  currentTee: process.env.NEXT_PUBLIC_AVERLOCK_TEE_ID as Address | undefined,
  instructionSender: publicAddress(process.env.NEXT_PUBLIC_AVERLOCK_INSTRUCTION_SENDER, "0x530D307Cca3A01BfC9139934b3F5Fa1DA19E728D"),
} as const;

export const fccConfig = {
  extensionId: 65_927n,
  instructionFee: 1_000_000n,
} as const;

/**
 * Receipt-backed selectors identify which guard the overview should read. They are not
 * dashboard values: every amount, status and schedule is still fetched from Coston2.
 * GuardManager intentionally has no owner/rule enumeration, and the public RPC limits
 * eth_getLogs to 30 blocks, so an unbounded browser-side discovery scan is not viable.
 */
export const dashboardSelection = {
  ruleId: (process.env.NEXT_PUBLIC_AVERLOCK_RULE_ID || "0x2a3a9591def2b67120f829c342d002de5e2def49ac0f4044a6be143071489400") as Hex,
  eventHash: "0xc4d12008caea289e8809d9f2884522ed85aac29600e43d1f07a566c896514819" as Hex,
  actionId: (process.env.NEXT_PUBLIC_AVERLOCK_ACTION_ID || "0x9dc08cf157b56885ffef6a30f5fc9ff56f74c3aad1b163844bba07a84ed74a63") as Hex,
  positionId: BigInt(process.env.NEXT_PUBLIC_AVERLOCK_POSITION_ID || "1"),
  registrationBlock: BigInt(process.env.NEXT_PUBLIC_AVERLOCK_REGISTRATION_BLOCK || "33660559"),
  executionBlock: BigInt(process.env.NEXT_PUBLIC_AVERLOCK_EXECUTION_BLOCK || "33679021"),
} as const;

// Optional public proof metadata. No placeholder values are supplied: absent historical
// indexes remain explicitly unavailable on the verification page.
export const publicProofMetadata = {
  xrplTransaction: process.env.NEXT_PUBLIC_AVERLOCK_XRPL_TRANSACTION,
  fdcRequestTransaction: process.env.NEXT_PUBLIC_AVERLOCK_FDC_REQUEST_TRANSACTION as Hex | undefined,
  fdcVotingRound: process.env.NEXT_PUBLIC_AVERLOCK_FDC_VOTING_ROUND,
  xrplDestination: process.env.NEXT_PUBLIC_AVERLOCK_XRPL_DESTINATION,
  deliveredDrops: process.env.NEXT_PUBLIC_AVERLOCK_XRPL_DELIVERED_DROPS,
} as const;

export const publicClient = createPublicClient({ chain: coston2, transport: http(coston2.rpcUrls.default.http[0]) });
export const wagmiConfig = createConfig({ chains: [coston2], connectors: [injected()], transports: { [coston2.id]: http(coston2.rpcUrls.default.http[0]) }, ssr: true });
