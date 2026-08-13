"use client";

import { useAccount, useConnect, useDisconnect, useSwitchChain } from "wagmi";
import { baseSepolia } from "@/lib/base/config";
import { compactAddress } from "@/lib/averlock/format";
import { Icon } from "./icons";

export function WalletControl() {
  const { address, isConnected, chainId } = useAccount();
  const { connect, connectors, isPending } = useConnect();
  const { disconnect } = useDisconnect();
  const { switchChain } = useSwitchChain();
  if (!isConnected) return <button className="wallet-button" aria-label="Connect wallet" onClick={() => connectors[0] && connect({ connector: connectors[0] })}><Icon name="wallet"/> {isPending ? "Connecting…" : "Connect wallet"}</button>;
  if (chainId !== baseSepolia.id) return <button className="wallet-button wrong" aria-label="Switch connected wallet to Base Sepolia" onClick={() => switchChain({ chainId: baseSepolia.id })}>Switch to Base Sepolia</button>;
  return <button className="wallet-button connected" onClick={() => disconnect()} title="Disconnect wallet" aria-label={`Disconnect wallet ${address}`}><span className="wallet-dot"/>{compactAddress(address)}</button>;
}
