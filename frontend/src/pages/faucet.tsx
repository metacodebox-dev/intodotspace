import Head from 'next/head';
import { Layout } from '@/components/Layout';
import { useState, useEffect, useCallback, useRef } from 'react';
import { useAuth } from '@/context/AuthContext';
import { useWallet } from '@solana/wallet-adapter-react';

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001';

interface FaucetStatus {
  canClaim: boolean;
  nextClaimAt: string | null;
  lastClaimAt: string | null;
  lastTxSignature: string | null;
  amountPerClaim: number;
}

interface ClaimResult {
  success: boolean;
  message: string;
  txSignature?: string;
}

function useCountdown(nextClaimAt: string | null, onExpire: () => void) {
  const [countdown, setCountdown] = useState('');
  const intervalRef = useRef<NodeJS.Timeout | null>(null);

  useEffect(() => {
    if (intervalRef.current) clearInterval(intervalRef.current);

    if (!nextClaimAt) {
      setCountdown('');
      return;
    }

    const update = () => {
      const diff = new Date(nextClaimAt).getTime() - Date.now();
      if (diff <= 0) {
        setCountdown('');
        onExpire();
        if (intervalRef.current) clearInterval(intervalRef.current);
        return;
      }
      const h = Math.floor(diff / 3600000);
      const m = Math.floor((diff % 3600000) / 60000);
      const s = Math.floor((diff % 60000) / 1000);
      setCountdown(
        `${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`
      );
    };

    update();
    intervalRef.current = setInterval(update, 1000);
    return () => { if (intervalRef.current) clearInterval(intervalRef.current); };
  }, [nextClaimAt]);

  return countdown;
}

function FaucetCard({
  title,
  description,
  amount,
  unit,
  statusEndpoint,
  claimEndpoint,
  token,
  isAuthenticated,
  connected,
  icon,
}: {
  title: string;
  description: string;
  amount: string;
  unit: string;
  statusEndpoint: string;
  claimEndpoint: string;
  token: string | null;
  isAuthenticated: boolean;
  connected: boolean;
  icon: React.ReactNode;
}) {
  const [status, setStatus] = useState<FaucetStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [claiming, setClaiming] = useState(false);
  const [claimResult, setClaimResult] = useState<ClaimResult | null>(null);

  const fetchStatus = useCallback(async () => {
    if (!isAuthenticated || !token) {
      setLoading(false);
      return;
    }
    try {
      const response = await fetch(`${API_URL}${statusEndpoint}`, {
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
      });
      if (response.ok) {
        const data = await response.json();
        setStatus(data.data);
      }
    } catch (error) {
      console.error(`Failed to fetch ${title} status:`, error);
    } finally {
      setLoading(false);
    }
  }, [isAuthenticated, token, statusEndpoint, title]);

  useEffect(() => {
    fetchStatus();
  }, [fetchStatus]);

  const countdown = useCountdown(status?.nextClaimAt || null, () => {
    setStatus((prev) => prev ? { ...prev, canClaim: true, nextClaimAt: null } : null);
  });

  const handleClaim = async () => {
    if (!isAuthenticated || !token || claiming) return;
    setClaiming(true);
    setClaimResult(null);
    try {
      const response = await fetch(`${API_URL}${claimEndpoint}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
      });
      const data = await response.json();
      if (response.ok && data.success) {
        setClaimResult({
          success: true,
          message: data.data.message,
          txSignature: data.data.txSignature,
        });
        await fetchStatus();
      } else {
        setClaimResult({
          success: false,
          message: data.error?.message || 'Claim failed. Please try again.',
        });
      }
    } catch {
      setClaimResult({ success: false, message: 'Network error. Please try again.' });
    } finally {
      setClaiming(false);
    }
  };

  return (
    <div className="w-full rounded-2xl border border-[#262626] bg-[#141414] p-8 text-center">
      {/* Header */}
      <div className="mb-5">
        <div className="w-14 h-14 mx-auto mb-3 rounded-full bg-[#262626] flex items-center justify-center">
          {icon}
        </div>
        <h2 className="text-2xl font-bold text-white">{title}</h2>
        <p className="mt-2 text-sm text-space-gray-400">{description}</p>
      </div>

      {/* Not connected */}
      {!connected && (
        <p className="py-4 text-space-gray-400 text-sm">Connect your wallet to claim.</p>
      )}

      {/* Connected but not authenticated */}
      {connected && !isAuthenticated && (
        <p className="py-4 text-space-gray-400 text-sm">Please sign in to claim.</p>
      )}

      {/* Authenticated */}
      {isAuthenticated && (
        <div className="space-y-4">
          {/* Amount */}
          <div className="bg-[#1a1a1a] rounded-xl p-5 border border-[#333]">
            <p className="text-sm text-space-gray-400 mb-1">Claim Amount</p>
            <p className="text-3xl font-bold text-white">{amount} {unit}</p>
            <p className="text-xs text-space-gray-400 mt-1">Devnet Test Tokens</p>
          </div>

          {/* Countdown */}
          {!status?.canClaim && countdown && (
            <div className="bg-[#1a1a1a] rounded-xl p-3 border border-[#333]">
              <p className="text-sm text-space-gray-400 mb-1">Next claim available in</p>
              <p className="text-2xl font-mono font-bold text-white">{countdown}</p>
            </div>
          )}

          {/* Claim button */}
          <button
            onClick={handleClaim}
            disabled={claiming || loading || !status?.canClaim}
            className={`w-full py-3.5 px-6 rounded-xl font-semibold text-base transition-all ${
              status?.canClaim && !claiming
                ? 'bg-white text-black hover:bg-gray-200 cursor-pointer'
                : 'bg-[#333] text-space-gray-400 cursor-not-allowed'
            }`}
          >
            {claiming
              ? 'Claiming...'
              : loading
                ? 'Loading...'
                : status?.canClaim
                  ? `Claim ${amount} ${unit}`
                  : 'Already Claimed Today'}
          </button>

          {/* Result */}
          {claimResult && (
            <div
              className={`rounded-xl p-4 border ${
                claimResult.success
                  ? 'bg-green-500/10 border-green-500/30 text-green-400'
                  : 'bg-red-500/10 border-red-500/30 text-red-400'
              }`}
            >
              <p className="text-sm font-medium">{claimResult.message}</p>
              {claimResult.txSignature && (
                <a
                  href={`https://explorer.solana.com/tx/${claimResult.txSignature}?cluster=devnet`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-xs underline mt-2 inline-block opacity-80 hover:opacity-100"
                >
                  View on Solana Explorer
                </a>
              )}
            </div>
          )}

          {/* Last claim */}
          {status?.lastClaimAt && (
            <div className="text-xs text-space-gray-400">
              Last claimed: {new Date(status.lastClaimAt).toLocaleString()}
              {status.lastTxSignature && (
                <>
                  {' | '}
                  <a
                    href={`https://explorer.solana.com/tx/${status.lastTxSignature}?cluster=devnet`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="underline hover:text-white"
                  >
                    tx
                  </a>
                </>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export default function Faucet() {
  const { isAuthenticated, token } = useAuth();
  const { connected } = useWallet();

  return (
    <>
      <Head>
        <title>Faucet - Space</title>
        <meta name="description" content="Claim test USDC, SPC, and SOL on Space Devnet" />
      </Head>

      <Layout>
        <div className="min-h-[60vh] flex items-center justify-center py-8">
          <div className="w-full max-w-5xl grid grid-cols-1 md:grid-cols-3 gap-6">
            {/* USDC Faucet */}
            <FaucetCard
              title="USDC Faucet"
              description="Claim 100 test USDC every 24 hours to trade on Space Devnet."
              amount="100"
              unit="USDC"
              statusEndpoint="/api/v1/faucet/status"
              claimEndpoint="/api/v1/faucet/claim"
              token={token}
              isAuthenticated={isAuthenticated}
              connected={connected}
              icon={
                <svg className="w-7 h-7 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                    d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
                  />
                </svg>
              }
            />

            {/* SPC Faucet */}
            <FaucetCard
              title="SPC Faucet"
              description="Claim 100 test SPC every 24 hours to trade SPC-denominated markets."
              amount="100"
              unit="SPC"
              statusEndpoint="/api/v1/faucet/space/status"
              claimEndpoint="/api/v1/faucet/space/claim"
              token={token}
              isAuthenticated={isAuthenticated}
              connected={connected}
              icon={
                <svg className="w-7 h-7 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                    d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z"
                  />
                </svg>
              }
            />

            {/* SOL Faucet */}
            <FaucetCard
              title="SOL Faucet"
              description="Claim 0.01 SOL every 24 hours to cover transaction fees."
              amount="0.01"
              unit="SOL"
              statusEndpoint="/api/v1/faucet/sol/status"
              claimEndpoint="/api/v1/faucet/sol/claim"
              token={token}
              isAuthenticated={isAuthenticated}
              connected={connected}
              icon={
                <svg className="w-7 h-7 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                    d="M13 10V3L4 14h7v7l9-11h-7z"
                  />
                </svg>
              }
            />
          </div>
        </div>
      </Layout>
    </>
  );
}
