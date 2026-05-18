"use client";

import { FC, ReactNode, useMemo } from "react";
import {
  ConnectionProvider,
  WalletProvider as SolanaWalletProvider,
} from "@solana/wallet-adapter-react";
import { WalletAdapterNetwork } from "@solana/wallet-adapter-base";
import { WalletModalProvider } from "@solana/wallet-adapter-react-ui";
import {
  PhantomWalletAdapter,
  SolflareWalletAdapter,
  BitgetWalletAdapter,
} from "@solana/wallet-adapter-wallets";
import { clusterApiUrl } from "@solana/web3.js";
import { BinanceWalletAdapter } from "@/utils/BinanceWalletAdapter";
import { AuthProvider } from "@/context/AuthContext";
import { SpacePointsProvider } from "@/context/SpacePointsContext";

import "@solana/wallet-adapter-react-ui/styles.css";

interface Props {
  children: ReactNode;
}

export const WalletProvider: FC<Props> = ({ children }) => {
  const network = WalletAdapterNetwork.Devnet;
  // HTTP RPC goes through our same-origin proxy at /api/rpc, which forwards
  // to the paid Solana RPC server-side. The upstream URL (with API key)
  // stays in SOLANA_RPC_URL on the server and is never bundled into the
  // client. Falls back to the public cluster URL only if /api/rpc is
  // unreachable for some reason (it shouldn't be).
  const endpoint = useMemo(() => {
    if (typeof window === 'undefined') {
      // SSR — use the public RPC since /api/rpc isn't reachable from the
      // server render path. The browser-side connection (which is what
      // matters) reuses the same Provider tree and will pick up /api/rpc.
      return clusterApiUrl(network);
    }
    return `${window.location.origin}/api/rpc`;
  }, [network]);

  // WebSocket subscriptions can't be proxied via /api/rpc (no WS upgrade in
  // Next.js API routes). If you set NEXT_PUBLIC_SOLANA_WS_URL we use it;
  // otherwise web3.js falls back to deriving from `endpoint` and subscriptions
  // silently won't work — that's acceptable since we don't rely on them.
  const wsEndpoint = process.env.NEXT_PUBLIC_SOLANA_WS_URL;
  const config = useMemo(
    () => ({
      // Default is 30s — too tight under devnet/mainnet congestion. Many
      // txs land at ~30-60s; 90s gives them headroom before the wallet
      // surfaces a "transaction was not confirmed" error to the user.
      confirmTransactionInitialTimeout: 90_000,
      commitment: 'confirmed' as const,
      ...(wsEndpoint ? { wsEndpoint } : {}),
    }),
    [wsEndpoint],
  );

  const wallets = useMemo(
    () => [
      new PhantomWalletAdapter(),
      new SolflareWalletAdapter(),
      new BitgetWalletAdapter(),
      new BinanceWalletAdapter(),
    ],
    [],
  );

  return (
    <ConnectionProvider endpoint={endpoint} config={config}>
      <SolanaWalletProvider wallets={wallets} autoConnect>
        <WalletModalProvider>
          <AuthProvider>
            <SpacePointsProvider>{children}</SpacePointsProvider>
          </AuthProvider>
        </WalletModalProvider>
      </SolanaWalletProvider>
    </ConnectionProvider>
  );
};
