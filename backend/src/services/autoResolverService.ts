import { Op } from 'sequelize';
import { Market } from '../models/Market';
import { binancePriceService } from './binancePriceService';
import { autoMarketKeeperService } from './autoMarketKeeperService';
import { PublicKey } from '@solana/web3.js';

const RESOLVE_POLL_MS = 60_000;  // Check every 60s (was 30s)
const FINALIZE_POLL_MS = 120_000; // Check every 120s (was 60s)

const log = {
  info: (...args: any[]) => console.log('[AutoResolver]', ...args),
  error: (...args: any[]) => console.error('[AutoResolver]', ...args),
  warn: (...args: any[]) => console.warn('[AutoResolver]', ...args),
};

/**
 * Cron-driven resolver that:
 * 1. Resolves auto-markets whose resolve_at has passed (Active → Resolving)
 * 2. Finalizes auto-markets after challenge period (Resolving → Finalized)
 * 3. Recovers admin liquidity after finalization
 */
export class AutoResolverService {
  private resolveInterval: NodeJS.Timeout | null = null;
  private finalizeInterval: NodeJS.Timeout | null = null;
  private running = false;

  start() {
    if (this.running) return;
    if (!autoMarketKeeperService.isReady) {
      log.warn('AutoKeeper not ready — resolver will not start');
      return;
    }
    this.running = true;

    this.resolveInterval = setInterval(() => this.resolveExpiredMarkets(), RESOLVE_POLL_MS);
    this.finalizeInterval = setInterval(() => this.finalizeReadyMarkets(), FINALIZE_POLL_MS);

    log.info('AutoResolver started');
    // Run once immediately
    this.resolveExpiredMarkets();
    this.finalizeReadyMarkets();
  }

  stop() {
    this.running = false;
    if (this.resolveInterval) clearInterval(this.resolveInterval);
    if (this.finalizeInterval) clearInterval(this.finalizeInterval);
    log.info('AutoResolver stopped');
  }

  /** Find auto-markets past their resolve_at and call resolve_oracle */
  private async resolveExpiredMarkets() {
    try {
      const markets = await Market.findAll({
        where: {
          autoResolve: true,
          status: 0, // Active
          resolveAt: { [Op.lte]: new Date() },
        },
        limit: 10,
      });

      for (const market of markets) {
        if (!this.running) return;
        await this.resolveOne(market);
      }
    } catch (e: any) {
      log.error('resolveExpiredMarkets error:', e.message);
    }
  }

  private async resolveOne(market: any) {
    const priceFeed = market.priceFeed;
    const strikePrice = market.strikePrice / 100; // cents → dollars

    // Get current Binance price
    const priceData = binancePriceService.getPrice(priceFeed);
    if (!priceData) {
      log.warn(`Cannot resolve ${market.id}: ${priceFeed} price stale/missing — will retry`);
      return;
    }

    const currentPrice = priceData.price;
    // YES (outcome 0) wins if price went up
    const winningOutcome = currentPrice > strikePrice ? 0 : 1;

    log.info(`Resolving ${market.marketAddress}: strike=$${strikePrice} now=$${currentPrice.toFixed(2)} → outcome ${winningOutcome}`);

    try {
      const marketPDA = new PublicKey(market.marketAddress);
      await autoMarketKeeperService.resolveMarket(marketPDA, winningOutcome);

      // Update backend DB
      market.status = 1; // Resolving
      market.resolvedOutcome = winningOutcome;
      market.resolvedAt = new Date();
      await market.save();

      log.info(`Resolved ${market.marketAddress} → outcome ${winningOutcome} (${winningOutcome === 0 ? 'Yes' : 'No'})`);
    } catch (e: any) {
      log.error(`Failed to resolve ${market.marketAddress}:`, e.message);

      // Self-heal: if on-chain says market is not Active, DB is out of sync.
      // Fetch actual on-chain state and reconcile.
      if (e.message?.includes('MarketNotActive') || e.message?.includes('AccountNotInitialized')) {
        const marketPDA = new PublicKey(market.marketAddress);
        const onChain = await autoMarketKeeperService.getOnChainMarketState(marketPDA);

        if (!onChain) {
          log.warn(`Market ${market.marketAddress} not found on-chain — marking Invalid`);
          market.status = 4;
          await market.save();
          return;
        }

        log.info(`Reconciling ${market.marketAddress}: on-chain status=${onChain.status}, resolvedOutcome=${onChain.resolvedOutcome}`);
        market.status = onChain.status;
        if (onChain.resolvedOutcome !== null) {
          market.resolvedOutcome = onChain.resolvedOutcome;
          if (!market.resolvedAt) market.resolvedAt = new Date();
        }
        await market.save();
      }
    }
  }

  /** Find resolved auto-markets whose challenge period has passed and finalize */
  private async finalizeReadyMarkets() {
    try {
      // Challenge period ≈ 15 min (1000 slots on devnet)
      // Wait challenge + small buffer before attempting finalize
      const challengeMins = parseInt(process.env.AUTO_MARKET_CHALLENGE_MINS || '20');
      const cutoff = new Date(Date.now() - challengeMins * 60 * 1000);

      const markets = await Market.findAll({
        where: {
          autoResolve: true,
          status: 1, // Resolving
          resolvedAt: { [Op.lte]: cutoff },
        },
        limit: 10,
      });

      for (const market of markets) {
        if (!this.running) return;
        await this.finalizeOne(market);
      }
    } catch (e: any) {
      log.error('finalizeReadyMarkets error:', e.message);
    }
  }

  private async finalizeOne(market: any) {
    const marketPDA = new PublicKey(market.marketAddress);

    try {
      // Step 1: Finalize on-chain
      await autoMarketKeeperService.finalizeMarket(marketPDA);

      market.status = 3; // Finalized
      await market.save();
      log.info(`Finalized ${market.marketAddress}`);

      // Step 2: Recover admin liquidity (async, non-blocking)
      const resolvedOutcome = market.resolvedOutcome as number;
      let seedOrderIds = null;
      try {
        seedOrderIds = market.seedOrderIds ? JSON.parse(market.seedOrderIds) : null;
      } catch { /* ignore parse errors */ }

      if (seedOrderIds) {
        autoMarketKeeperService.recoverLiquidity(marketPDA, resolvedOutcome, seedOrderIds).catch((e: any) => {
          log.warn(`Liquidity recovery failed for ${market.marketAddress}: ${e.message}`);
        });
      } else {
        log.warn(`No seed order IDs found for ${market.marketAddress} — skipping cancel, only redeeming shares`);
      }
    } catch (e: any) {
      if (e.message?.includes('ChallengePeriodNotExpired')) {
        log.info(`Challenge period not yet expired for ${market.marketAddress} — will retry later`);
        return;
      }

      log.error(`Failed to finalize ${market.marketAddress}:`, e.message);

      // Self-heal on InvalidResolution or MarketNotActive — DB/on-chain drift
      if (e.message?.includes('InvalidResolution') || e.message?.includes('MarketNotActive')) {
        const onChain = await autoMarketKeeperService.getOnChainMarketState(marketPDA);
        if (!onChain) {
          log.warn(`Market ${market.marketAddress} not found on-chain — marking Invalid`);
          market.status = 4;
          await market.save();
          return;
        }

        log.info(`Reconciling finalize for ${market.marketAddress}: on-chain status=${onChain.status}, resolvedOutcome=${onChain.resolvedOutcome}`);
        market.status = onChain.status;
        if (onChain.resolvedOutcome !== null) {
          market.resolvedOutcome = onChain.resolvedOutcome;
        }
        await market.save();

        // If on-chain is already Finalized (3), proceed to liquidity recovery
        if (onChain.status === 3) {
          let seedOrderIds = null;
          try { seedOrderIds = market.seedOrderIds ? JSON.parse(market.seedOrderIds) : null; } catch {}
          if (seedOrderIds && onChain.resolvedOutcome !== null) {
            log.info(`Market was already finalized on-chain — running liquidity recovery`);
            autoMarketKeeperService.recoverLiquidity(marketPDA, onChain.resolvedOutcome, seedOrderIds).catch((err: any) => {
              log.warn(`Post-reconcile liquidity recovery failed: ${err.message}`);
            });
          }
        }
      }
    }
  }
}

export const autoResolverService = new AutoResolverService();
