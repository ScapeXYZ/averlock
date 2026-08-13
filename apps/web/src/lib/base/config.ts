import {
  createPublicClient,
  defineChain,
  http,
  isAddress,
  zeroAddress,
  type Address,
} from "viem";
import { createConfig } from "wagmi";
import { injected } from "wagmi/connectors";

export const baseSepolia = defineChain({
  id: 84532,
  name: "Base Sepolia",
  nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
  rpcUrls: {
    default: {
      http: [
        process.env.NEXT_PUBLIC_BASE_SEPOLIA_RPC_URL ||
          "https://sepolia.base.org",
      ],
    },
  },
  blockExplorers: {
    default: { name: "BaseScan", url: "https://sepolia.basescan.org" },
  },
  testnet: true,
});
export const BASE_SEPOLIA_DEPLOYMENT_BLOCK = 45_438_094n;
export const BASE_SEPOLIA_RPC_URL =
  process.env.NEXT_PUBLIC_BASE_SEPOLIA_RPC_URL || "https://sepolia.base.org";
export const BASE_SEPOLIA_GUARD_MANAGER =
  "0xB2d5B8a9dF91466F07fcBA92f334cb143197151d" as Address;
export const BASE_SEPOLIA_PROTECTION_VAULT =
  "0x5f7a95160A34e84B91e25903b69B8B378094a9B0" as Address;
export const BASE_SEPOLIA_APPROVED_TOKEN =
  "0x036CbD53842c5426634e7929541eC2318f3dCF7e" as Address;
const configuredAddress = (name: string) => {
  const value = process.env[name];
  if (!value) return undefined;
  return isAddress(value) ? (value as Address) : zeroAddress;
};
export const baseContracts = {
  guardManager:
    configuredAddress("NEXT_PUBLIC_BASE_GUARD_MANAGER") ??
    BASE_SEPOLIA_GUARD_MANAGER,
  protectionVault:
    configuredAddress("NEXT_PUBLIC_BASE_PROTECTION_VAULT") ??
    BASE_SEPOLIA_PROTECTION_VAULT,
  approvedToken:
    configuredAddress("NEXT_PUBLIC_BASE_APPROVED_TOKEN") ??
    BASE_SEPOLIA_APPROVED_TOKEN,
} as const;
export const deploymentConfigured = Object.values(baseContracts).every(
  (address) => address !== zeroAddress,
);
export const basePublicClient = createPublicClient({
  chain: baseSepolia,
  transport: http(BASE_SEPOLIA_RPC_URL),
});
export const baseWagmiConfig = createConfig({
  chains: [baseSepolia],
  connectors: [injected()],
  transports: { [baseSepolia.id]: http(BASE_SEPOLIA_RPC_URL) },
  ssr: true,
});
