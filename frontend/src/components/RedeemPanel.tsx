import { useState, useEffect } from 'react';
import { useConnection, useWallet } from '@solana/wallet-adapter-react';
import { PublicKey } from '@solana/web3.js';
import { getAssociatedTokenAddress, getAccount } from '@solana/spl-token';
import { useSpaceProgram } from '@/hooks/useSpaceProgram';
import { getYesMintPDA, getNoMintPDA, getPositionPDA, getOldPositionPDA, SPACE_CORE_PROGRAM_ID } from '@/utils/solana';
import { Market, isNewModelMarket } from '@/types/market';
import { Program } from '@coral-xyz/anchor';

interface Props {
  market: Market;
}

interface LeveragedPosition {
  pda: PublicKey;
  shares: number;
  collateral: number;
  borrowedAmount: number;
  leverage: number;
  outcomeId: number;
  avgEntryPrice: number;
  tokenType: number; // 0 = YES, 1 = NO
}

/**
 * A leveraged position wins when:
 *  - tokenType=YES: position's outcomeId equals the resolved outcome
 *  - tokenType=NO:  position's outcomeId does NOT equal the resolved outcome
 *    (holding NO of X pays out iff X did not win)
 */
function isLeveragedWinner(pos: LeveragedPosition, resolvedOutcome: number | null): boolean {
  if (resolvedOutcome === null || resolvedOutcome === undefined) return false;
  return pos.tokenType === 0
    ? pos.outcomeId === resolvedOutcome
    : pos.outcomeId !== resolvedOutcome;
}

/** Per-outcome balance info for the new model */
interface OutcomeBalance {
  outcomeId: number;
  label: string;
  yesBalance: number; // lamports
  noBalance: number;  // lamports
  isWinner: boolean;
}

const MARKET_STATUS = ['Active', 'Resolving', 'Disputed', 'Finalized', 'Invalid'];

export function RedeemPanel({ market }: Props) {
  const { connection } = useConnection();
  const wallet = useWallet();
  const { redeemShares, settleLeveragedPosition, loading, isReady, program } = useSpaceProgram();

  const quoteDecimals = market.quoteDecimals ?? 6;
  const quoteSymbol = market.quoteSymbol ?? 'USDC';
  // quoteUnit scales on-chain quote-denominated fields (position.collateral,
  // position.borrowedAmount). Share token balances are always 6 decimals so
  // they continue to use the SHARE_UNIT constant below.
  const quoteUnit = Math.pow(10, quoteDecimals);
  const SHARE_UNIT = 1_000_000;
  // Multiplier that promotes a share-denominated value (6 dec) to the market's
  // quote base units. 1 for USDC, 1000 for SPACE — matches the on-chain
  // `quote_scale` helper so PnL math in this panel lines up with what the
  // program actually moves during settle/redeem.
  const quoteScaleFromShares = Math.pow(10, Math.max(0, quoteDecimals - 6));

  const [winningBalance, setWinningBalance] = useState<number | null>(null);
  const [losingBalance, setLosingBalance] = useState<number | null>(null);
  const [outcomeBalances, setOutcomeBalances] = useState<OutcomeBalance[]>([]);
  // We must surface EVERY leveraged position the user holds on this market.
  // Previously this was a single ref and the scan stopped at the first hit
  // (`foundLeveraged = true; break`), which hid winning NO positions whenever
  // the user also had a losing YES position (or vice versa) on the same
  // market. Each entry gets its own card + settle button.
  const [leveragedPositions, setLeveragedPositions] = useState<LeveragedPosition[]>([]);
  const [settlingPda, setSettlingPda] = useState<string | null>(null);
  const [redeemAmount, setRedeemAmount] = useState<string>('');
  const [status, setStatus] = useState<{ type: 'success' | 'error' | 'info'; message: string } | null>(null);
  const [fetchingBalance, setFetchingBalance] = useState(false);

  const newModel = isNewModelMarket(market);

  // Market status check
  const marketStatus = typeof market.status === 'string' ? parseInt(market.status) : (market.status || 0);
  const isFinalized = marketStatus === 3; // Finalized
  const isResolving = marketStatus === 1; // Resolving (challenge period)
  const resolvedOutcome = market.resolvedOutcome ?? market.resolved_outcome ?? null;

  // Fetch user's token balances and leveraged positions
  useEffect(() => {
    const fetchBalances = async () => {
      if (!wallet.publicKey || !isFinalized || resolvedOutcome === null) return;

      setFetchingBalance(true);
      try {
        const marketPDA = new PublicKey(market.id);

        const numOutcomes = market.outcomes?.length || 2;
        const isBinary = numOutcomes === 2;

        if (newModel) {
          // New model: per-outcome NO mints
          // Fetch YES and NO balances for ALL outcomes
          const balances: OutcomeBalance[] = [];

          for (let oid = 0; oid < numOutcomes; oid++) {
            const [yesMintPDA] = getYesMintPDA(marketPDA, oid);
            const [noMintPDA] = getNoMintPDA(marketPDA, oid);
            const isWinner = oid === resolvedOutcome;

            let yesBalance = 0;
            let noBalance = 0;

            try {
              const yesATA = await getAssociatedTokenAddress(yesMintPDA, wallet.publicKey);
              const yesAccount = await getAccount(connection, yesATA);
              yesBalance = Number(yesAccount.amount);
            } catch (e) {
              // No balance
            }

            try {
              const noATA = await getAssociatedTokenAddress(noMintPDA, wallet.publicKey);
              const noAccount = await getAccount(connection, noATA);
              noBalance = Number(noAccount.amount);
            } catch (e) {
              // No balance
            }

            balances.push({
              outcomeId: oid,
              label: market.outcomes?.[oid]?.label || `Outcome ${oid}`,
              yesBalance,
              noBalance,
              isWinner,
            });
          }

          setOutcomeBalances(balances);

          // Set aggregate winning balance (YES of winning outcome)
          const winnerBal = balances.find(b => b.isWinner);
          setWinningBalance(winnerBal?.yesBalance ?? 0);

          // For new model, losing NO shares of non-winning outcomes are also redeemable ($1 each)
          // Sum of all NO balances for losing outcomes (outcomes that did NOT win)
          const losingNoTotal = balances
            .filter(b => !b.isWinner)
            .reduce((sum, b) => sum + b.noBalance, 0);
          setLosingBalance(losingNoTotal);
        } else if (isBinary) {
          // Old model Binary: YES(0) vs shared NO
          const [yesMintPDA] = getYesMintPDA(marketPDA, 0);
          const [noMintPDA] = getNoMintPDA(marketPDA);
          const winningMint = resolvedOutcome === 0 ? yesMintPDA : noMintPDA;
          const losingMint = resolvedOutcome === 0 ? noMintPDA : yesMintPDA;

          try {
            const winningATA = await getAssociatedTokenAddress(winningMint, wallet.publicKey);
            const winningAccount = await getAccount(connection, winningATA);
            setWinningBalance(Number(winningAccount.amount));
          } catch (e) {
            setWinningBalance(0);
          }

          try {
            const losingATA = await getAssociatedTokenAddress(losingMint, wallet.publicKey);
            const losingAccount = await getAccount(connection, losingATA);
            setLosingBalance(Number(losingAccount.amount));
          } catch (e) {
            setLosingBalance(0);
          }
        } else {
          // Old model Multi-outcome: winning = YES(resolvedOutcome), shared NO
          const [winningMint] = getYesMintPDA(marketPDA, resolvedOutcome);
          try {
            const winningATA = await getAssociatedTokenAddress(winningMint, wallet.publicKey);
            const winningAccount = await getAccount(connection, winningATA);
            setWinningBalance(Number(winningAccount.amount));
          } catch (e) {
            setWinningBalance(0);
          }
          setLosingBalance(0);
        }

        // Scan every (outcomeId, tokenType) combination on this market and
        // collect ALL leveraged positions the user holds. We can't bail
        // out early — a user can hedge with a YES leveraged AND a NO
        // leveraged on the same binary market, and both must be settled.
        if (program) {
          const numOutcomesToScan = market.outcomes?.length || 2;
          const collected: LeveragedPosition[] = [];
          const seenPdas = new Set<string>();

          // Helper: read user's SPL token balance for a mint, returning 0 if
          // the ATA doesn't exist. Used to filter out leveraged positions
          // whose tokens have already been burned by redeem_shares — the
          // on-chain Position account stays around (redeem_shares doesn't
          // touch it), but the underlying mint balance is 0, so there's
          // nothing left to settle. Without this, the panel kept showing
          // a stale "Leveraged Position … WON" card after a successful
          // redeem.
          const userMintBalance = async (mint: PublicKey): Promise<number> => {
            try {
              const ata = await getAssociatedTokenAddress(mint, wallet.publicKey!);
              const acct = await getAccount(connection, ata);
              return Number(acct.amount);
            } catch {
              return 0;
            }
          };

          const tryAdd = async (pda: PublicKey, position: any, tokenTypeFallback: number) => {
            const lev = position.leverage as number;
            const sharesNum = (position.shares as any).toNumber();
            if (lev <= 1 || sharesNum <= 0) return;
            const key = pda.toBase58();
            if (seenPdas.has(key)) return;

            // Real settlement check: does the user still hold the mint
            // tokens this position represents? If they don't, the position
            // is effectively settled even if its on-chain `shares` field is
            // non-zero.
            const tt = ((position as any).tokenType as number | undefined) ?? tokenTypeFallback;
            const outcomeId = position.outcomeId as number;
            const [relevantMint] = tt === 1
              ? getNoMintPDA(marketPDA, outcomeId)
              : getYesMintPDA(marketPDA, outcomeId);
            const mintBalance = await userMintBalance(relevantMint);
            if (mintBalance <= 0) return;

            seenPdas.add(key);
            collected.push({
              pda,
              shares: sharesNum,
              collateral: (position.collateral as any).toNumber(),
              borrowedAmount: (position.borrowedAmount as any).toNumber(),
              leverage: lev,
              outcomeId,
              avgEntryPrice: (position.avgEntryPrice as any).toNumber(),
              tokenType: tt,
            });
          };

          for (let oid = 0; oid < numOutcomesToScan; oid++) {
            for (let tokenTypeCheck = 0; tokenTypeCheck < 2; tokenTypeCheck++) {
              // New PDA format (with tokenType)
              const [newPDA] = getPositionPDA(marketPDA, wallet.publicKey, oid, 0, 1, tokenTypeCheck);
              try {
                const position = await program.account.position.fetch(newPDA);
                await tryAdd(newPDA, position, tokenTypeCheck);
              } catch { /* position doesn't exist at new PDA */ }
            }
            // Old PDA format (pre-tokenType migration — always YES)
            try {
              const [oldPDA] = getOldPositionPDA(marketPDA, wallet.publicKey, oid, 0, 1);
              const position = await program.account.position.fetch(oldPDA);
              await tryAdd(oldPDA, position, 0);
            } catch { /* old PDA doesn't exist */ }
          }

          setLeveragedPositions(collected);
        }
      } catch (err) {
        console.error('Failed to fetch balances:', err);
      } finally {
        setFetchingBalance(false);
      }
    };

    fetchBalances();
  }, [wallet.publicKey, market.id, isFinalized, resolvedOutcome, connection, program, newModel]);

  // Drop any stale error toast when fresh balance data arrives. Without
  // this, a previous "no winning shares to redeem" error stays visible
  // even after the user settles a leveraged position and the balance
  // numbers below show plenty of redeemable shares — confusing UX.
  useEffect(() => {
    if (status?.type === 'error') {
      setStatus(null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [winningBalance, losingBalance, outcomeBalances.length, leveragedPositions.length]);

  const handleRedeem = async () => {
    if (!wallet.publicKey || !isReady) {
      setStatus({ type: 'error', message: 'Please connect your wallet' });
      return;
    }

    // Old gate checked `winningBalance` only, which is just the YES of the
    // resolved outcome. On the new model a user can also be holding NO of
    // a losing outcome (also pays $1) so totalRedeemable is the right
    // metric. Without this, clicking Claim with valid NO winnings falsely
    // surfaced "You have no winning shares to redeem" while the panel
    // simultaneously displayed e.g. "Total Redeemable: 78.43 USDC".
    if (totalRedeemable === 0) {
      setStatus({ type: 'error', message: 'You have no winning shares to redeem' });
      return;
    }

    setStatus({ type: 'info', message: 'Redeeming all winning shares...' });

    try {
      const result = await redeemShares({
        market: market.id,
        amount: totalRedeemable,
        quoteDecimals,
        quoteSymbol,
      });

      const usdcAmount = (totalRedeemable / SHARE_UNIT).toFixed(2);
      setStatus({
        type: 'success',
        message: `Successfully redeemed all shares! You received ${usdcAmount} ${quoteSymbol}. Check your wallet balance.`
      });

      setRedeemAmount('');
      setWinningBalance(0);
      setLosingBalance(0);
      setOutcomeBalances([]);

      setTimeout(() => {
        window.location.reload();
      }, 2000);
    } catch (err: any) {
      setStatus({ type: 'error', message: err.message || 'Failed to redeem shares' });
    }
  };

  const handleSettleLeveragedPosition = async (pos: LeveragedPosition) => {
    if (!wallet.publicKey || !isReady) {
      setStatus({ type: 'error', message: 'Please connect your wallet' });
      return;
    }

    const pdaKey = pos.pda.toBase58();
    setSettlingPda(pdaKey);
    setStatus({ type: 'info', message: 'Settling leveraged position... Repaying borrowed funds to liquidity vault.' });

    try {
      await settleLeveragedPosition({
        market: market.id,
        positionPDA: pos.pda,
      });

      const userWon = isLeveragedWinner(pos, resolvedOutcome);
      const finalValueQuote = userWon ? pos.shares * quoteScaleFromShares : 0;
      const entryValueQuote = (pos.shares * pos.avgEntryPrice / 10000) * quoteScaleFromShares;
      const pnl = userWon ? finalValueQuote - entryValueQuote : -entryValueQuote;
      const equity = Math.max(0, pos.collateral + pnl);

      setStatus({
        type: 'success',
        message: userWon
          ? `Position settled! Borrowed ${(pos.borrowedAmount / quoteUnit).toFixed(2)} ${quoteSymbol} repaid. You received ~${(equity / quoteUnit).toFixed(2)} ${quoteSymbol} equity.`
          : `Position settled. Lost outcome - borrowed ${(pos.borrowedAmount / quoteUnit).toFixed(2)} ${quoteSymbol} repaid from collateral.`
      });

      // Drop just this position from the list — others can still be settled.
      setLeveragedPositions((prev) => prev.filter((p) => p.pda.toBase58() !== pdaKey));
    } catch (err: any) {
      setStatus({ type: 'error', message: err.message || 'Failed to settle position' });
    } finally {
      setSettlingPda(null);
    }
  };

  const winnerLabel = resolvedOutcome !== null && market.outcomes
    ? market.outcomes[resolvedOutcome]?.label || `Outcome ${resolvedOutcome}`
    : 'Unknown';

  // Calculate total redeemable for new model
  const totalRedeemable = newModel
    ? outcomeBalances.reduce((sum, ob) => {
        // Winning YES shares = $1 each
        if (ob.isWinner) sum += ob.yesBalance;
        // Losing outcomes' NO shares = $1 each (the event did NOT happen, so NO pays out)
        if (!ob.isWinner) sum += ob.noBalance;
        return sum;
      }, 0)
    : (winningBalance || 0);

  // Does the wallet hold ANYTHING in this market (winning, losing, or a
  // leveraged position)? This is the gate for rendering the panel at all.
  // Without it, anyone who never traded in a market still saw a full
  // "Claim Your Winnings" card with a "Winner: X" banner on the market page.
  const hasAnyHoldings =
    (winningBalance ?? 0) > 0 ||
    (losingBalance ?? 0) > 0 ||
    leveragedPositions.length > 0 ||
    outcomeBalances.some((b) => b.yesBalance > 0 || b.noBalance > 0);

  // Don't show panel for active markets
  if (marketStatus === 0) {
    return null;
  }

  // Don't show panel at all for wallets that never traded this market. Only
  // gate once finalized + wallet connected + fetch completed, so we don't
  // hide the "Connect your wallet" state and don't flicker during loading.
  // During Resolving we still show the challenge-period banner to anyone
  // watching.
  if (isFinalized && wallet.publicKey && !fetchingBalance && !hasAnyHoldings) {
    return null;
  }

  return (
    <div className="rounded-xl p-6 border border-space-gray-700/50">
      <h2 className="text-xl font-bold text-white mb-4">
        {isFinalized ? 'Claim Your Winnings' :
         isResolving ? 'Resolution Pending' :
         'Market Status'}
      </h2>

      {/* Resolving Status */}
      {isResolving && resolvedOutcome !== null && (
        <div className="bg-space-warning/10 border border-space-warning/30 rounded-lg p-4 mb-4">
          <h3 className="font-semibold text-space-warning mb-2">Challenge Period Active</h3>
          <p className="text-space-warning/80 text-sm">
            Proposed winner: <strong>{winnerLabel}</strong>
          </p>
          <p className="text-space-warning/80 text-sm mt-1">
            Please wait for the challenge period to end before redeeming.
          </p>
        </div>
      )}

      {/* Finalized - Can Redeem */}
      {isFinalized && resolvedOutcome !== null && (
        <>
          {/* Winner Banner */}
          <div className="mb-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center justify-between w-full gap-3">
                <h3 className="font-semibold text-space-success">Market Resolved</h3>
                <p className="text-space-success/80 text-sm">
                  Winner: <strong className="text-sm">{winnerLabel}</strong>
                </p>
              </div>
            </div>
          </div>

          {/* Leveraged Positions — render one card per leveraged position
              the user holds on this market. Without this, a user with both
              a YES and a NO leveraged position only saw one of them, and
              if the visible one happened to be the loser they got told
              "your bet lost" while the winning side stayed hidden. */}
          {leveragedPositions.map((pos) => {
            const pdaKey = pos.pda.toBase58();
            const won = isLeveragedWinner(pos, resolvedOutcome);
            const positionLabel = (() => {
              const outcomeLabel = market.outcomes?.[pos.outcomeId]?.label || `Outcome ${pos.outcomeId}`;
              const isBinary = (market.outcomes?.length ?? 2) === 2;
              if (pos.tokenType === 0) return `${outcomeLabel} ${pos.leverage}x`;
              if (isBinary) {
                const otherLabel = market.outcomes?.[1 - pos.outcomeId]?.label || 'No';
                return `${otherLabel} ${pos.leverage}x`;
              }
              return `No (${outcomeLabel}) ${pos.leverage}x`;
            })();
            const isThisSettling = settlingPda === pdaKey;
            return (
              <div key={pdaKey} className={`border rounded-lg p-4 mb-4 ${
                won
                  ? 'bg-space-success/5 border-space-success/30'
                  : 'bg-space-warning/10 border-space-warning/30'
              }`}>
                <h3 className={`font-semibold mb-3 ${won ? 'text-space-success' : 'text-space-warning'}`}>
                  Leveraged Position: {positionLabel} {won ? '— WON' : '— LOST'}
                </h3>
                <div className="grid grid-cols-2 gap-3 mb-4">
                  <div className="bg-space-gray-700/50 rounded-lg p-3 border border-space-gray-600">
                    <p className="text-xs text-space-gray-400">Position</p>
                    <p className="font-semibold text-white">{positionLabel}</p>
                  </div>
                  <div className="bg-space-gray-700/50 rounded-lg p-3 border border-space-gray-600">
                    <p className="text-xs text-space-gray-400">Shares</p>
                    <p className="font-semibold text-white">{(pos.shares / SHARE_UNIT).toFixed(2)}</p>
                  </div>
                  <div className="bg-space-gray-700/50 rounded-lg p-3 border border-space-gray-600">
                    <p className="text-xs text-space-gray-400">Your Collateral</p>
                    <p className="font-semibold text-space-success">
                      {(pos.collateral / quoteUnit).toFixed(2)} {quoteSymbol}
                    </p>
                  </div>
                  <div className="bg-space-gray-700/50 rounded-lg p-3 border border-space-gray-600">
                    <p className="text-xs text-space-gray-400">Borrowed (must repay)</p>
                    <p className="font-semibold text-space-danger">
                      {(pos.borrowedAmount / quoteUnit).toFixed(2)} {quoteSymbol}
                    </p>
                  </div>
                </div>

                <div className={`p-3 rounded-lg mb-4 ${
                  won
                    ? 'bg-space-success/10 border border-space-success/30'
                    : 'bg-space-danger/10 border border-space-danger/30'
                }`}>
                  <p className={`text-sm ${won ? 'text-space-success' : 'text-space-danger'}`}>
                    {won
                      ? 'You bet on the winning outcome! You\'ll receive your equity after repaying borrowed funds.'
                      : 'This bet lost. Borrowed funds will be repaid from your collateral.'}
                  </p>
                </div>

                <button
                  onClick={() => handleSettleLeveragedPosition(pos)}
                  disabled={isThisSettling || loading || !isReady || !wallet.publicKey}
                  className={`w-full py-3 rounded-lg font-bold transition-all duration-200 ${
                    isThisSettling || loading || !isReady || !wallet.publicKey
                      ? 'bg-space-gray-600 text-space-gray-400 cursor-not-allowed'
                      : won
                        ? 'bg-space-success hover:bg-space-success/90 text-black'
                        : 'bg-space-warning hover:bg-space-warning/90 text-black'
                  }`}
                >
                  {isThisSettling ? 'Processing...' : 'Settle Position'}
                </button>

                <p className="text-xs text-space-gray-400 text-center mt-2">
                  Borrowed amount will be repaid to liquidity vault first
                </p>
              </div>
            );
          })}

          {/* Status message — shared across leveraged settlements + redeem */}
          {status && (
            <div className={`p-3 rounded-lg mb-4 ${
              status.type === 'success' ? 'bg-space-success/10 border border-space-success/30' :
              status.type === 'error' ? 'bg-space-danger/10 border border-space-danger/30' :
              'bg-space-info/10 border border-space-info/30'
            }`}>
              <p className={`text-sm ${
                status.type === 'success' ? 'text-space-success' :
                status.type === 'error' ? 'text-space-danger' :
                'text-space-info'
              }`}>
                {status.message}
              </p>
            </div>
          )}

          {/* Non-Leveraged Balance Display — always show. Previously hidden
              whenever any leveraged position existed, which made the user's
              winning NO shares disappear entirely. */}
          {true && (
            <>
              {/* New Model: Per-outcome breakdown */}
              {newModel && outcomeBalances.length > 0 && (
                <div className="space-y-3 mb-4">
                  <h3 className="text-sm font-semibold text-space-gray-300">Redeemable Shares by Outcome</h3>
                  {outcomeBalances.map((ob) => {
                    const hasRedeemable = ob.isWinner ? ob.yesBalance > 0 : ob.noBalance > 0;
                    const redeemableAmount = ob.isWinner ? ob.yesBalance : ob.noBalance;
                    const redeemableType = ob.isWinner ? 'YES' : 'NO';

                    return (
                      <div
                        key={ob.outcomeId}
                        className={`rounded-lg p-3 border ${
                          ob.isWinner
                            ? 'bg-space-success/10 border-space-success/30'
                            : 'bg-space-gray-700/50 border-space-gray-600/30'
                        }`}
                      >
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-2">
                            <span className={`text-sm font-medium ${ob.isWinner ? 'text-space-success' : 'text-space-gray-300'}`}>
                              {ob.label}
                            </span>
                            {ob.isWinner && (
                              <span className="text-xs bg-space-success/20 text-space-success px-2 py-0.5 rounded">Winner</span>
                            )}
                          </div>
                          <div className="text-right">
                            {hasRedeemable ? (
                              <>
                                <p className={`text-sm font-bold ${ob.isWinner ? 'text-space-success' : 'text-white'}`}>
                                  {(redeemableAmount / SHARE_UNIT).toFixed(2)} {redeemableType}
                                </p>
                                <p className="text-xs text-space-gray-500">
                                  = {(redeemableAmount / SHARE_UNIT).toFixed(2)} {quoteSymbol}
                                </p>
                              </>
                            ) : (
                              <p className="text-sm text-space-gray-500">No shares</p>
                            )}
                          </div>
                        </div>
                        {!ob.isWinner && ob.noBalance > 0 && (
                          <p className="text-xs text-space-gray-400 mt-1">
                            NO shares pay $1 each (this outcome lost)
                          </p>
                        )}
                      </div>
                    );
                  })}

                  {/* Total redeemable summary */}
                  <div className="bg-space-gray-700/50 rounded-lg p-4 border border-space-gray-600/30">
                    <div className="flex items-center justify-between">
                      <span className="text-sm text-space-gray-400">Total Redeemable</span>
                      <div className="text-right">
                        <p className="text-xl font-bold text-space-success">
                          {(totalRedeemable / SHARE_UNIT).toFixed(2)} {quoteSymbol}
                        </p>
                      </div>
                    </div>
                  </div>
                </div>
              )}

              {/* Old Model: Simple winning/losing display */}
              {!newModel && (
                <div className="grid grid-cols-2 gap-4 mb-4">
                  <div className="rounded-lg p-4 border border-space-gray-600/80">
                    <p className="text-sm text-space-gray-400 mb-1">Your Winning Shares</p>
                    <p className="text-2xl font-bold text-space-success">
                      {fetchingBalance ? '...' :
                       winningBalance !== null ? (winningBalance / SHARE_UNIT).toFixed(2) : '0.00'}
                    </p>
                    <p className="text-xs text-space-gray-500">
                      = {winningBalance !== null ? (winningBalance / SHARE_UNIT).toFixed(2) : '0.00'} {quoteSymbol}
                    </p>
                  </div>
                  <div className="rounded-lg p-4 border border-space-gray-600">
                    <p className="text-sm text-space-gray-400 mb-1">Losing Shares (worthless)</p>
                    <p className="text-2xl font-bold text-space-danger">
                      {fetchingBalance ? '...' :
                       losingBalance !== null ? (losingBalance / SHARE_UNIT).toFixed(2) : '0.00'}
                    </p>
                    <p className="text-xs text-space-gray-500">= $0.00</p>
                  </div>
                </div>
              )}

              {/* Redeem Form */}
              {totalRedeemable > 0 && (
                <div className="space-y-4">
                  {/* Info about settlement/redemption */}
                  <div className="bg-space-info/10 border border-space-info/30 rounded-lg p-4">
                    <p className="text-sm text-space-info">
                      {newModel ? (
                        <>
                          <strong>Note:</strong> Winning YES shares and losing outcomes' NO shares each redeem for 1 {quoteSymbol}.
                          This will redeem <strong>ALL</strong> your eligible shares across all outcomes.
                        </>
                      ) : (
                        <>
                          <strong>Note:</strong> This will automatically check for leveraged positions and settle them first,
                          or redeem <strong>ALL</strong> your shares (both winning and losing).
                          You'll receive 1 {quoteSymbol} for each winning share. Losing shares are burned with no payout.
                        </>
                      )}
                    </p>
                  </div>

                  {/* Status Message */}
                  {status && (
                    <div className={`p-3 rounded-lg ${
                      status.type === 'success' ? 'bg-space-success/10 border border-space-success/30' :
                      status.type === 'error' ? 'bg-space-danger/10 border border-space-danger/30' :
                      'bg-space-info/10 border border-space-info/30'
                    }`}>
                      <p className={`text-sm ${
                        status.type === 'success' ? 'text-space-success' :
                        status.type === 'error' ? 'text-space-danger' :
                        'text-space-info'
                      }`}>
                        {status.message}
                      </p>
                    </div>
                  )}

                  {/* Redeem non-leveraged share tokens. Leveraged positions
                      are settled separately above via per-position cards. */}
                  <button
                    onClick={handleRedeem}
                    disabled={loading || !isReady || !wallet.publicKey || totalRedeemable === 0}
                    className={`w-full py-4 rounded-lg font-bold text-lg transition-all duration-200 ${
                      loading || !isReady || !wallet.publicKey || totalRedeemable === 0
                        ? 'bg-space-gray-600 text-space-gray-400 cursor-not-allowed'
                        : 'bg-space-success hover:bg-space-success/90 text-black'
                    }`}
                  >
                    {loading ? 'Processing...' :
                     !wallet.publicKey ? 'Connect Wallet' :
                     totalRedeemable === 0 ? 'No winning shares to redeem' :
                     `Claim Winnings (${(totalRedeemable / SHARE_UNIT).toFixed(2)} ${quoteSymbol})`}
                  </button>

                  <p className="text-xs text-space-gray-400 text-center">
                    {newModel
                      ? `Winning YES + losing NO shares redeemed. Each share = 1 ${quoteSymbol}. Transaction fees apply.`
                      : `All shares will be redeemed. Winning shares = 1 ${quoteSymbol} each. Transaction fees apply.`}
                  </p>
                </div>
              )}

              {/* No Redeemable Shares */}
              {totalRedeemable === 0 && !fetchingBalance && (
                <div className="text-center py-2">
                  <p className="text-space-gray-400">You have no redeemable shares.</p>
                  <p className="text-sm text-space-gray-500 mt-2">
                    The winning outcome was <strong>{winnerLabel}</strong>.
                  </p>
                </div>
              )}
            </>
          )}

          {/* Not Connected */}
          {!wallet.publicKey && (
            <div className="text-center py-4">
              <p className="text-space-gray-400">Connect your wallet to check your winnings.</p>
            </div>
          )}
        </>
      )}
    </div>
  );
}
