import { useState, useEffect } from 'react';
import { useWallet, useConnection } from '@solana/wallet-adapter-react';
import { PublicKey } from '@solana/web3.js';
import { Market } from '@/types/market';
import { useSpaceProgram } from '@/hooks/useSpaceProgram';
import { USDC_MINT, getYesMintPDA, getNoMintPDA } from '@/utils/solana';
import { getAssociatedTokenAddress, getAccount } from '@solana/spl-token';

interface ShareMintingPanelProps {
  market: Market;
  outcomeId?: number;
}

export function ShareMintingPanel({ market, outcomeId = 0 }: ShareMintingPanelProps) {
  const { connected, publicKey } = useWallet();
  const { connection } = useConnection();
  const { mintShares, burnShares, loading: programLoading, isReady } = useSpaceProgram();

  const quoteMint = market.quoteMint ? new PublicKey(market.quoteMint) : USDC_MINT;
  const quoteDecimals = market.quoteDecimals ?? 6;
  const quoteSymbol = market.quoteSymbol ?? 'USDC';
  const quoteUnit = Math.pow(10, quoteDecimals);

  const [mode, setMode] = useState<'mint' | 'burn'>('mint');
  const [amount, setAmount] = useState(100);
  const [loading, setLoading] = useState(false);
  const [selectedOutcomeId, setSelectedOutcomeId] = useState(outcomeId);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const [quoteBalance, setQuoteBalance] = useState<number | null>(null);
  const [yesBalance, setYesBalance] = useState<number | null>(null);
  const [noBalance, setNoBalance] = useState<number | null>(null);

  const selectedOutcome = market.outcomes[selectedOutcomeId];

  // Fetch balances
  useEffect(() => {
    if (!connected || !publicKey) {
      setQuoteBalance(null);
      setYesBalance(null);
      setNoBalance(null);
      return;
    }

    const fetchBalances = async () => {
      try {
        const quoteAta = await getAssociatedTokenAddress(quoteMint, publicKey);
        try {
          const quoteAccount = await getAccount(connection, quoteAta);
          setQuoteBalance(Number(quoteAccount.amount) / quoteUnit);
        } catch {
          setQuoteBalance(0);
        }

        // Get YES and NO mint PDAs — detect old (no outcomeId) vs new (per-outcome)
        const marketPDA = new PublicKey(market.id);
        const [newYesMint] = getYesMintPDA(marketPDA, selectedOutcomeId);
        const [oldYesMint] = getYesMintPDA(marketPDA);
        const newYesMintInfo = await connection.getAccountInfo(newYesMint);
        const yesMintPDA = (newYesMintInfo && newYesMintInfo.data.length > 0) ? newYesMint : oldYesMint;

        const [newNoMint] = getNoMintPDA(marketPDA, selectedOutcomeId);
        const [oldNoMint] = getNoMintPDA(marketPDA);
        const newNoMintInfo = await connection.getAccountInfo(newNoMint);
        const noMintPDA = (newNoMintInfo && newNoMintInfo.data.length > 0) ? newNoMint : oldNoMint;

        // YES token balance
        const yesAta = await getAssociatedTokenAddress(yesMintPDA, publicKey);
        try {
          const yesAccount = await getAccount(connection, yesAta);
          setYesBalance(Number(yesAccount.amount) / 1e6);
        } catch {
          setYesBalance(0);
        }

        // NO token balance (per-outcome in new model)
        const noAta = await getAssociatedTokenAddress(noMintPDA, publicKey);
        try {
          const noAccount = await getAccount(connection, noAta);
          setNoBalance(Number(noAccount.amount) / 1e6);
        } catch {
          setNoBalance(0);
        }
      } catch (error) {
        console.error('Error fetching balances:', error);
      }
    };

    fetchBalances();
    const interval = setInterval(fetchBalances, 5000);
    return () => clearInterval(interval);
  }, [connected, publicKey, connection, market.id, selectedOutcomeId]);

  const handleMint = async () => {
    if (!connected || !publicKey || !isReady) {
      setError('Please connect your wallet');
      return;
    }

    setLoading(true);
    setError(null);
    setSuccess(null);

    try {
      // `amount` is expressed in shares; share mints are always 6 decimals. The
      // program scales this up to quote base units internally (x1 for USDC, x1000
      // for SPACE) so one input unit always equals one quote unit end-to-end.
      const amountLamports = Math.floor(amount * 1e6);

      await mintShares({
        market: market.id,
        outcomeId: selectedOutcomeId,
        amount: amountLamports,
        quoteMint: market.quoteMint,
      });

      setSuccess(`Successfully minted ${amount} ${market.outcomes?.[selectedOutcomeId]?.label || 'YES'} + ${amount} NO shares!`);
      
      // Refresh balances after minting
      setTimeout(() => {
        const fetchBalances = async () => {
          try {
            const marketPDA = new PublicKey(market.id);
            const [newYM] = getYesMintPDA(marketPDA, selectedOutcomeId);
            const [oldYM] = getYesMintPDA(marketPDA);
            const newYMInfo = await connection.getAccountInfo(newYM);
            const yesMintPDA = (newYMInfo && newYMInfo.data.length > 0) ? newYM : oldYM;
            const [newNM] = getNoMintPDA(marketPDA, selectedOutcomeId);
            const [oldNM] = getNoMintPDA(marketPDA);
            const newNMInfo = await connection.getAccountInfo(newNM);
            const noMintPDA = (newNMInfo && newNMInfo.data.length > 0) ? newNM : oldNM;

            const yesAta = await getAssociatedTokenAddress(yesMintPDA, publicKey!);
            const noAta = await getAssociatedTokenAddress(noMintPDA, publicKey!);

            try {
              const yesAccount = await getAccount(connection, yesAta);
              setYesBalance(Number(yesAccount.amount) / 1e6);
            } catch {
              setYesBalance(0);
            }

            try {
              const noAccount = await getAccount(connection, noAta);
              setNoBalance(Number(noAccount.amount) / 1e6);
            } catch {
              setNoBalance(0);
            }
          } catch (error) {
            console.error('Error refreshing balances:', error);
          }
        };
        fetchBalances();
      }, 2000); // Wait 2 seconds for transaction to confirm
    } catch (err: any) {
      console.error('Mint failed:', err);
      setError(err.message || 'Failed to mint shares');
    } finally {
      setLoading(false);
    }
  };

  const handleBurn = async () => {
    if (!connected || !publicKey || !isReady) {
      setError('Please connect your wallet');
      return;
    }

    setLoading(true);
    setError(null);
    setSuccess(null);

    try {
      const amountLamports = Math.floor(amount * 1e6);

      // Call burn_shares on the program
      await burnShares({
        market: market.id,
        outcomeId: selectedOutcomeId,
        amount: amountLamports,
        quoteMint: market.quoteMint,
      });

      setSuccess(`Successfully burned ${amount} ${market.outcomes?.[selectedOutcomeId]?.label || 'YES'} + ${amount} NO shares and received ${amount} ${quoteSymbol}!`);
      
      // Refresh balances after burning
      setTimeout(() => {
        const fetchBalances = async () => {
          try {
            const marketPDA = new PublicKey(market.id);
            const [newYM2] = getYesMintPDA(marketPDA, selectedOutcomeId);
            const [oldYM2] = getYesMintPDA(marketPDA);
            const newYM2Info = await connection.getAccountInfo(newYM2);
            const yesMintPDA = (newYM2Info && newYM2Info.data.length > 0) ? newYM2 : oldYM2;
            const [newNM2] = getNoMintPDA(marketPDA, selectedOutcomeId);
            const [oldNM2] = getNoMintPDA(marketPDA);
            const newNM2Info = await connection.getAccountInfo(newNM2);
            const noMintPDA = (newNM2Info && newNM2Info.data.length > 0) ? newNM2 : oldNM2;

            const yesAta = await getAssociatedTokenAddress(yesMintPDA, publicKey!);
            const noAta = await getAssociatedTokenAddress(noMintPDA, publicKey!);

            try {
              const yesAccount = await getAccount(connection, yesAta);
              setYesBalance(Number(yesAccount.amount) / 1e6);
            } catch {
              setYesBalance(0);
            }

            try {
              const noAccount = await getAccount(connection, noAta);
              setNoBalance(Number(noAccount.amount) / 1e6);
            } catch {
              setNoBalance(0);
            }
          } catch (error) {
            console.error('Error refreshing balances:', error);
          }
        };
        fetchBalances();
      }, 2000); // Wait 2 seconds for transaction to confirm
    } catch (err: any) {
      console.error('Burn failed:', err);
      setError(err.message || 'Failed to burn shares');
    } finally {
      setLoading(false);
    }
  };

  const canMint = quoteBalance !== null && quoteBalance >= amount;
  const canBurn = yesBalance !== null && noBalance !== null && yesBalance >= amount && noBalance >= amount;

  // Quick amount buttons
  const quickAmounts = [10, 50, 100, 500];

  return (
    <div className="rounded-xl border border-[#262626] overflow-hidden">
      {/* Header */}
      <div className="px-4 py-3 border-b border-[#262626]">
        <h3 className="text-sm font-semibold text-white">Share Minting</h3>
      </div>

      {/* Mode Toggle */}
      <div className="p-4 border-b border-[#262626]">
        <div className="flex p-1 bg-[#1a1a1a] rounded-lg">
          <button
            onClick={() => setMode('mint')}
            className={`flex-1 py-2 px-3 text-sm font-medium rounded-md transition-colors ${
              mode === 'mint'
                ? 'bg-white text-black'
                : 'text-space-gray-400 hover:text-white'
            }`}
          >
            Mint
          </button>
          <button
            onClick={() => setMode('burn')}
            className={`flex-1 py-2 px-3 text-sm font-medium rounded-md transition-colors ${
              mode === 'burn'
                ? 'bg-white text-black'
                : 'text-space-gray-400 hover:text-white'
            }`}
          >
            Burn
          </button>
        </div>
      </div>

      {/* Outcome Selector (for multi-outcome markets) */}
      {market.outcomes && market.outcomes.length > 2 && (
        <div className="px-4 py-3 border-b border-[#262626]">
          <label className="block text-xs text-space-gray-400 mb-2">Select Outcome</label>
          <select
            value={selectedOutcomeId}
            onChange={(e) => setSelectedOutcomeId(Number(e.target.value))}
            className="w-full bg-[#1a1a1a] border border-[#262626] rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:border-[#404040] cursor-pointer"
          >
            {market.outcomes.map((outcome: any) => (
              <option key={outcome.id} value={outcome.id}>
                {outcome.label}
              </option>
            ))}
          </select>
          <p className="text-xs text-space-gray-500 mt-1">
            Minting creates YES({market.outcomes[selectedOutcomeId]?.label || `Outcome ${selectedOutcomeId}`}) + NO tokens
          </p>
        </div>
      )}

      {/* Balances */}
      <div className="px-4 py-3 border-b border-[#262626] bg-[#0f0f0f]">
        <div className="flex items-center justify-between text-xs">
          <div className="flex items-center gap-4">
            <div>
              <span className="text-space-gray-500">{quoteSymbol}</span>
              <span className="ml-2 text-white font-medium">
                {quoteBalance !== null ? quoteBalance.toFixed(2) : '-'}
              </span>
            </div>
            <div>
              <span className="text-space-gray-500">{market.outcomes?.length > 2 ? (market.outcomes[selectedOutcomeId]?.label || 'YES') : 'YES'}</span>
              <span className="ml-2 text-white font-medium">
                {yesBalance !== null ? yesBalance.toFixed(2) : '-'}
              </span>
            </div>
            <div>
              <span className="text-space-gray-500">NO({market.outcomes?.[selectedOutcomeId]?.label || `#${selectedOutcomeId}`})</span>
              <span className="ml-2 text-white font-medium">
                {noBalance !== null ? noBalance.toFixed(2) : '-'}
              </span>
            </div>
          </div>
        </div>
      </div>

      {/* Amount Input */}
      <div className="p-4 space-y-3">
        <div>
          <label className="block text-xs text-space-gray-400 mb-2">
            {mode === 'mint' ? `Amount (${quoteSymbol})` : 'Pairs to burn'}
          </label>
          <div className="relative">
            <input
              type="number"
              value={amount}
              onChange={(e) => setAmount(Number(e.target.value))}
              className="w-full bg-[#1a1a1a] border border-[#262626] rounded-lg px-4 py-3 text-white text-lg font-medium focus:outline-none focus:border-[#404040] transition-colors"
              placeholder="0"
              min={0}
            />
            <span className="absolute right-4 top-1/2 -translate-y-1/2 text-space-gray-500 text-sm">
              {mode === 'mint' ? quoteSymbol : 'pairs'}
            </span>
          </div>
        </div>

        {/* Quick Amount Buttons */}
        <div className="flex gap-2">
          {quickAmounts.map((quickAmount) => (
            <button
              key={quickAmount}
              onClick={() => setAmount(quickAmount)}
              className={`flex-1 py-1.5 text-xs font-medium rounded-md border transition-colors ${
                amount === quickAmount
                  ? 'border-white text-white bg-white/10'
                  : 'border-[#262626] text-space-gray-400 hover:border-[#404040] hover:text-white'
              }`}
            >
              {quickAmount}
            </button>
          ))}
        </div>

        {/* Summary */}
        <div className="flex items-center justify-between py-2 text-sm">
          <span className="text-space-gray-400">You'll receive</span>
          <span className="text-white font-medium">
            {mode === 'mint'
              ? `${amount} YES + ${amount} NO`
              : `${amount.toFixed(2)} ${quoteSymbol}`
            }
          </span>
        </div>

        {/* Action Button */}
        <button
          onClick={mode === 'mint' ? handleMint : handleBurn}
          disabled={loading || !connected || (mode === 'mint' ? !canMint : !canBurn)}
          className="w-full py-3 bg-white hover:bg-gray-100 disabled:bg-[#262626] disabled:text-space-gray-500 text-black font-semibold rounded-lg transition-colors disabled:cursor-not-allowed"
        >
          {loading
            ? 'Processing...'
            : !connected
            ? 'Connect Wallet'
            : mode === 'mint'
            ? (canMint ? `Mint ${amount} Pairs` : `Insufficient ${quoteSymbol}`)
            : (canBurn ? `Burn ${amount} Pairs` : 'Insufficient Shares')
          }
        </button>

        {/* Error/Success Messages */}
        {error && (
          <div className="p-3 bg-red-500/10 border border-red-500/20 rounded-lg text-red-400 text-xs">
            {error}
          </div>
        )}
        {success && (
          <div className="p-3 bg-green-500/10 border border-green-500/20 rounded-lg text-green-400 text-xs">
            {success}
          </div>
        )}

        {/* Info */}
        <p className="text-xs text-space-gray-500 text-center pt-2">
          {mode === 'mint'
            ? `1 ${quoteSymbol} = 1 ${market.outcomes?.[selectedOutcomeId]?.label || 'YES'} + 1 NO token pair`
            : `1 ${market.outcomes?.[selectedOutcomeId]?.label || 'YES'} + 1 NO = 1 ${quoteSymbol} back`
          }
        </p>
      </div>
    </div>
  );
}
