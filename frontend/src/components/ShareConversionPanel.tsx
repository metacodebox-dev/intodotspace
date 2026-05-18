import { useState, useEffect } from 'react';
import { useWallet, useConnection } from '@solana/wallet-adapter-react';
import { Market, isNewModelMarket } from '@/types/market';
import { useSpaceProgram } from '@/hooks/useSpaceProgram';
import { getAssociatedTokenAddress, getAccount } from '@solana/spl-token';
import { getNoMintPDA } from '@/utils/solana';
import { PublicKey } from '@solana/web3.js';

interface ShareConversionPanelProps {
  market: Market;
}

/**
 * Share Conversion Panel for Multi-Outcome Markets (OLD model only)
 *
 * Converts NO shares into YES shares of a chosen outcome (1:1):
 * - NO shares are fungible across all outcomes (shared mint)
 * - Burning NO is equivalent to gaining YES exposure on another outcome
 * - No additional capital required
 *
 * NOTE: This panel is hidden for new-model markets (per-outcome NO mints / Polymarket model)
 * because NO shares are no longer shared across outcomes.
 *
 * Based on Space docs: https://docs.into.space/en/features/multi-outcome
 */
export function ShareConversionPanel({ market }: ShareConversionPanelProps) {
  const { connected, publicKey } = useWallet();
  const { connection } = useConnection();
  const { convertShares, loading: programLoading, isReady } = useSpaceProgram();

  const [toOutcomeId, setToOutcomeId] = useState(0);
  const [amount, setAmount] = useState(100); // In shares
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  // NO token balance (shared across all outcomes - old model only)
  const [noBalance, setNoBalance] = useState(0);

  // New-model markets use per-outcome NO mints, so share conversion doesn't apply
  if (isNewModelMarket(market)) {
    return null;
  }

  // Only show for multi-outcome markets
  if (!market.isMultiOutcome || market.outcomes.length <= 2) {
    return null;
  }

  // Fetch NO token balance
  useEffect(() => {
    if (!connected || !publicKey || !market) {
      setNoBalance(0);
      return;
    }

    const fetchBalance = async () => {
      try {
        const [noMintPDA] = getNoMintPDA(new PublicKey(market.id));
        const noATA = await getAssociatedTokenAddress(noMintPDA, publicKey);
        const noAccount = await getAccount(connection, noATA);
        setNoBalance(Number(noAccount.amount) / 1e6);
      } catch {
        setNoBalance(0);
      }
    };

    fetchBalance();
    const interval = setInterval(fetchBalance, 5000);
    return () => clearInterval(interval);
  }, [connected, publicKey, connection, market]);

  const handleConvert = async () => {
    if (!connected || !publicKey || !isReady) {
      setError('Please connect your wallet');
      return;
    }

    if (noBalance < amount) {
      setError(`Insufficient NO shares. You have ${noBalance.toFixed(2)} shares.`);
      return;
    }

    setLoading(true);
    setError(null);
    setSuccess(null);

    try {
      // Convert amount to lamports (6 decimals)
      const amountLamports = Math.floor(amount * 1e6);

      await convertShares({
        market: market.id,
        toOutcomeId,
        amount: amountLamports,
      });

      const toLabel = market.outcomes[toOutcomeId]?.label || `Outcome ${toOutcomeId}`;

      setSuccess(`Successfully converted ${amount} NO shares to ${toLabel} YES shares!`);
    } catch (err: any) {
      console.error('Convert failed:', err);
      setError(err.message || 'Failed to convert shares');
    } finally {
      setLoading(false);
    }
  };

  const canConvert = noBalance >= amount && amount > 0;

  return (
    <div className="bg-space-gray-800 rounded-xl border border-space-gray-700 p-6">
      <h3 className="text-lg font-bold text-white mb-4">Convert Shares</h3>

      {/* Info Box */}
      <div className="bg-space-gray-700/50 rounded-lg p-4 mb-6 text-sm">
        <p className="text-space-gray-300 mb-2">
          <span className="text-space-primary font-semibold">NO → YES:</span> Convert your NO shares into YES shares for any outcome
        </p>
        <p className="text-space-gray-400 text-xs mt-2">
          NO shares are shared across all outcomes. Converting burns NO and mints YES for your chosen outcome (1:1, no extra capital needed).
        </p>
      </div>

      {/* NO Balance Display */}
      <div className="mb-4 bg-space-gray-700/30 rounded-lg p-3 flex justify-between items-center">
        <span className="text-sm text-space-gray-400">Your NO Balance</span>
        <span className="text-white font-mono font-semibold">{noBalance.toFixed(2)} shares</span>
      </div>

      {/* To Outcome */}
      <div className="mb-4">
        <label className="block text-sm text-space-gray-400 mb-2">Convert to YES for</label>
        <select
          value={toOutcomeId}
          onChange={(e) => setToOutcomeId(Number(e.target.value))}
          className="w-full bg-space-gray-700 border border-space-gray-600 rounded-lg px-4 py-3 text-white focus:outline-none focus:border-space-primary"
        >
          {market.outcomes.map((outcome) => (
            <option key={outcome.id} value={outcome.id}>
              {outcome.label}
            </option>
          ))}
        </select>
      </div>

      {/* Amount Input */}
      <div className="mb-6">
        <label className="block text-sm text-space-gray-400 mb-2">
          Amount to Convert
        </label>
        <div className="relative">
          <input
            type="number"
            value={amount}
            onChange={(e) => setAmount(Number(e.target.value))}
            className="w-full bg-space-gray-700 border border-space-gray-600 rounded-lg px-4 py-3 text-white font-mono focus:outline-none focus:border-space-primary"
            placeholder="Enter amount"
            min={0}
            max={noBalance}
          />
          <span className="absolute right-4 top-1/2 -translate-y-1/2 text-space-gray-400">
            shares
          </span>
        </div>
        <div className="flex justify-between mt-2 text-sm text-space-gray-400">
          <span>Available NO:</span>
          <span className="text-white">{noBalance.toFixed(2)} shares</span>
        </div>
      </div>

      {/* Action Button */}
      <button
        onClick={handleConvert}
        disabled={loading || !connected || !canConvert}
        className="w-full py-4 rounded-lg font-bold text-lg bg-space-primary hover:bg-space-primary/90 disabled:bg-space-gray-600 text-white disabled:cursor-not-allowed transition-colors"
      >
        {loading
          ? 'Processing...'
          : `Convert ${amount} NO → YES`}
      </button>

      {/* Error/Success Messages */}
      {error && (
        <div className="mt-4 p-3 bg-red-500/10 border border-red-500/30 rounded-lg text-red-400 text-sm">
          {error}
        </div>
      )}
      {success && (
        <div className="mt-4 p-3 bg-green-500/10 border border-green-500/30 rounded-lg text-green-400 text-sm">
          {success}
        </div>
      )}

      {!connected && (
        <p className="mt-4 text-center text-space-gray-400 text-sm">
          Connect your wallet to convert shares
        </p>
      )}
    </div>
  );
}





