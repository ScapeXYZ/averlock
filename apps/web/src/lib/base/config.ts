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
const configuredAddress = (name: string) => {
  const value = process.env[name];
  return value && isAddress(value) ? (value as Address) : zeroAddress;
};
export const baseContracts = {
  guardManager: configuredAddress("NEXT_PUBLIC_BASE_GUARD_MANAGER"),
  protectionVault: configuredAddress("NEXT_PUBLIC_BASE_PROTECTION_VAULT"),
  approvedToken: configuredAddress("NEXT_PUBLIC_BASE_APPROVED_TOKEN"),
} as const;
export const deploymentConfigured = Object.values(baseContracts).every(
  (address) => address !== zeroAddress,
);
export const basePublicClient = createPublicClient({
  chain: baseSepolia,
  transport: http(baseSepolia.rpcUrls.default.http[0]),
});
export const baseWagmiConfig = createConfig({
  chains: [baseSepolia],
  connectors: [injected()],
  transports: { [baseSepolia.id]: http(baseSepolia.rpcUrls.default.http[0]) },
  ssr: true,
});
