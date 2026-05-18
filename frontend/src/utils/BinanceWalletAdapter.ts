import {
  BaseMessageSignerWalletAdapter,
  WalletName,
  WalletReadyState,
  WalletNotConnectedError,
  WalletNotReadyError,
} from "@solana/wallet-adapter-base";
import type { Transaction, VersionedTransaction } from "@solana/web3.js";
import { PublicKey } from "@solana/web3.js";

interface BinanceProvider {
  isConnected: boolean;
  publicKey?: { toBytes(): Uint8Array } | null;
  connect(): Promise<{ publicKey: { toBytes(): Uint8Array } }>;
  disconnect(): Promise<void>;
  signTransaction<T extends Transaction | VersionedTransaction>(
    tx: T,
  ): Promise<T>;
  signAllTransactions<T extends Transaction | VersionedTransaction>(
    txs: T[],
  ): Promise<T[]>;
  signMessage(message: Uint8Array): Promise<{ signature: Uint8Array }>;
  on(event: string, callback: (...args: any[]) => void): void;
  off(event: string, callback: (...args: any[]) => void): void;
}

export const BinanceWalletName =
  "Binance Wallet" as WalletName<"Binance Wallet">;

const BINANCE_INSTALL_URL =
  "https://chromewebstore.google.com/detail/binance-wallet/cadiboklkpojfamcoggejbbdjcoiljjk?utm_source=faq";

function getBinanceProvider(): BinanceProvider | null {
  if (typeof window === "undefined") return null;
  const w = window as any;
  return w.binancew3w?.solana ?? null;
}

export class BinanceWalletAdapter extends BaseMessageSignerWalletAdapter {
  name = BinanceWalletName;
  url = BINANCE_INSTALL_URL;
  icon =
    "data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHZpZXdCb3g9IjAgMCAxMDI0IDEwMjQiIHdpZHRoPSIxMjgiIGhlaWdodD0iMTI4Ij48Y2lyY2xlIGN4PSI1MTIiIGN5PSI1MTIiIHI9IjUxMiIgZmlsbD0iI2YzYmEyZiIvPjxwYXRoIGZpbGw9IiNmZmYiIGQ9Ik00MDQuOSA0NjggNTEyIDM2MC45bDEwNy4xIDEwNy4yIDYyLjMtNjIuM0w1MTIgMjM2LjMgMzQyLjYgNDA1Ljd6Ii8+PHBhdGggZmlsbD0iI2ZmZiIgZD0iTTI1NC42IDQ2Ny45aDg4LjFWNTU2aC04OC4xeiIgdHJhbnNmb3JtPSJyb3RhdGUoLTQ1LjAwMSAyOTguNjI5IDUxMS45OTgpIi8+PHBhdGggZmlsbD0iI2ZmZiIgZD0iTTQwNC45IDU1NiA1MTIgNjYzLjFsMTA3LjEtMTA3LjIgNjIuNCA2Mi4zaC0uMUw1MTIgNzg3LjcgMzQyLjYgNjE4LjNsLS4xLS4xeiIvPjxwYXRoIGZpbGw9IiNmZmYiIGQ9Ik02ODEuMyA0NjhoODguMXY4OC4xaC04OC4xeiIgdHJhbnNmb3JtPSJyb3RhdGUoLTQ1LjAwMSA3MjUuMzY0IDUxMi4wMzIpIi8+PHBhdGggZmlsbD0iI2ZmZiIgZD0iTTU3NS4yIDUxMiA1MTIgNDQ4LjdsLTQ2LjcgNDYuOC01LjQgNS4zLTExLjEgMTEuMS0uMS4xLjEuMSA2My4yIDYzLjIgNjMuMi02My4zeiIvPjwvc3ZnPg==" as const;
  supportedTransactionVersions = null;
  // Always report Installed so the modal's click handler calls select() -> connect().
  // If the extension isn't actually present, connect() opens the install page.
  readyState =
    typeof window === "undefined"
      ? WalletReadyState.Unsupported
      : WalletReadyState.Installed;

  private _provider: BinanceProvider | null = null;
  private _publicKey: PublicKey | null = null;
  private _connecting = false;

  get publicKey() {
    return this._publicKey;
  }

  get connecting() {
    return this._connecting;
  }

  async connect(): Promise<void> {
    try {
      if (this.connected || this._connecting) return;

      const provider = getBinanceProvider();

      // If not installed, open install page
      if (!provider) {
        if (typeof window !== "undefined") {
          window.open(BINANCE_INSTALL_URL, "_blank");
        }
        throw new WalletNotReadyError();
      }

      this._connecting = true;

      const resp = await provider.connect();
      this._provider = provider;
      this._publicKey = new PublicKey(resp.publicKey.toBytes());

      provider.on("disconnect", this._onDisconnect);

      this.emit("connect", this._publicKey);
    } catch (error: any) {
      this.emit("error", error);
      throw error;
    } finally {
      this._connecting = false;
    }
  }

  async disconnect(): Promise<void> {
    if (this._provider) {
      this._provider.off("disconnect", this._onDisconnect);
      try {
        await this._provider.disconnect();
      } catch {
        // ignore
      }
    }
    this._provider = null;
    this._publicKey = null;
    this.emit("disconnect");
  }

  async signTransaction<T extends Transaction | VersionedTransaction>(
    tx: T,
  ): Promise<T> {
    if (!this._provider) throw new WalletNotConnectedError();
    return this._provider.signTransaction(tx);
  }

  async signAllTransactions<T extends Transaction | VersionedTransaction>(
    txs: T[],
  ): Promise<T[]> {
    if (!this._provider) throw new WalletNotConnectedError();
    return this._provider.signAllTransactions(txs);
  }

  async signMessage(message: Uint8Array): Promise<Uint8Array> {
    if (!this._provider) throw new WalletNotConnectedError();
    const resp = await this._provider.signMessage(message);
    return resp.signature;
  }

  private _onDisconnect = () => {
    this._publicKey = null;
    this._provider = null;
    this.emit("disconnect");
  };
}
