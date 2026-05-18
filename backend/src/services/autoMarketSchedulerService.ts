import { Market } from '../models/Market';
import { binancePriceService } from './binancePriceService';
import { autoMarketKeeperService } from './autoMarketKeeperService';

const SYMBOLS = [
  {
    feed: 'btcusdt',
    name: 'BTC/USDT',
    imageUrl: 'https://raw.githubusercontent.com/spothq/cryptocurrency-icons/master/128/color/btc.png',
  },
  {
    feed: 'ethusdt',
    name: 'ETH/USDT',
    imageUrl: 'https://raw.githubusercontent.com/spothq/cryptocurrency-icons/master/128/color/eth.png',
  },
  {
    feed: 'solusdt',
    name: 'SOL/USDT',
    imageUrl: 'https://assets.coingecko.com/coins/images/4128/large/solana.png',
  },
];

const TIMEFRAMES = [
  { label: '15m', secs: 15 * 60 },
  { label: '1h',  secs: 60 * 60 },
];

const INITIAL_COLLATERAL = 1_000_000_000; // 1000 USDC (min required by program)

const log = {
  info: (...args: any[]) => console.log('[AutoScheduler]', ...args),
  error: (...args: any[]) => console.error('[AutoScheduler]', ...args),
  warn: (...args: any[]) => console.warn('[AutoScheduler]', ...args),
};

/**
 * Cron-driven scheduler that creates auto-markets at fixed intervals.
 * - Every 15 minutes: 3 markets (BTC, ETH, SOL) resolving in 15m
 * - Every hour:       3 markets (BTC, ETH, SOL) resolving in 1h
 */
export class AutoMarketSchedulerService {
  private intervals: NodeJS.Timeout[] = [];
  private running = false;

  start() {
    if (this.running) return;
    if (!autoMarketKeeperService.isReady) {
      log.warn('AutoKeeper not ready — scheduler will not start');
      return;
    }
    this.running = true;

    for (const tf of TIMEFRAMES) {
      // Poll every 120s — actual market creation is gated by "is previous still active?" check.
      // This ensures a new market is created promptly after the previous one ends.
      const interval = setInterval(() => this.tick(tf), 120 * 1000);
      this.intervals.push(interval);
      log.info(`Scheduled ${tf.label} markets — polling every 60s, new one created when previous ends`);

      // First tick immediately
      this.tick(tf);
    }
  }

  stop() {
    this.running = false;
    for (const i of this.intervals) clearInterval(i);
    this.intervals = [];
    log.info('Scheduler stopped');
  }

  private async tick(tf: { label: string; secs: number }) {
    for (const sym of SYMBOLS) {
      if (!this.running) return;

      try {
        await this.createMarket(sym, tf);
      } catch (e: any) {
        log.error(`Failed to create ${sym.name} ${tf.label} market:`, e.message);
      }
    }
  }

  private async createMarket(
    sym: { feed: string; name: string; imageUrl: string },
    tf: { label: string; secs: number },
  ) {
    // 1. Get current price — skip if stale
    const priceData = binancePriceService.getPrice(sym.feed);
    if (!priceData) {
      log.warn(`Skipping ${sym.name} ${tf.label}: price not available or stale`);
      return;
    }

    const strikePrice = priceData.price;
    const nowSecs = Math.floor(Date.now() / 1000);
    const resolveAt = nowSecs + tf.secs;

    const title = `Will ${sym.name} be higher in ${tf.label}?`;
    const description = `Strike: $${strikePrice.toFixed(2)} at ${new Date().toISOString()}. ` +
      `Resolves at ${new Date(resolveAt * 1000).toISOString()} using Binance ${sym.feed.toUpperCase()} trade price.`;

    // 2. Only create a new market if no active market exists for this symbol+timeframe.
    //    (status=0 = Active, resolveAt > now means still trading)
    const { Op } = require('sequelize');
    const stillActive = await Market.findOne({
      where: {
        priceFeed: sym.feed,
        timeframeSecs: tf.secs,
        autoResolve: true,
        status: 0,
        resolveAt: { [Op.gt]: new Date() },
      },
    });
    if (stillActive) {
      log.info(`Skipping: ${sym.name} ${tf.label} still active (resolves at ${stillActive.resolveAt?.toISOString()})`);
      return;
    }

    // 3. Create on-chain
    const { marketPDA, seedOrderIds } = await autoMarketKeeperService.createAndSeedMarket({
      title,
      description,
      category: 1, // Crypto
      endDate: resolveAt,
      outcomes: ['Yes', 'No'],
      resolutionType: 1, // Oracle
      initialCollateral: INITIAL_COLLATERAL,
    });

    // 4. Persist in backend DB
    const adminKey = (await import('./autoMarketKeeperService')).autoMarketKeeperService;
    const creatorKey = process.env.AUTO_MARKET_KEEPER_KEYPAIR || process.env.KEEPER_KEYPAIR;
    let creatorPubkey = '';
    if (creatorKey) {
      try {
        const { Keypair } = await import('@solana/web3.js');
        creatorPubkey = Keypair.fromSecretKey(Uint8Array.from(JSON.parse(creatorKey))).publicKey.toBase58();
      } catch { /* ignore */ }
    }

    await Market.create({
      marketAddress: marketPDA.toBase58(),
      marketId: marketPDA.toBase58(),
      creator: creatorPubkey,
      title,
      description,
      imageUrl: sym.imageUrl,
      category: 0, // crypto
      status: 0, // Active
      outcomes: JSON.stringify([
        { id: 0, label: 'Yes', lastPrice: 5000 },
        { id: 1, label: 'No', lastPrice: 5000 },
      ]),
      endDate: new Date(resolveAt * 1000),
      totalVolume: '0',
      totalCollateral: '0',
      totalOpenInterest: '0',
      maxOpenInterest: '0',
      insuranceFund: '0',
      challengeBond: '0',
      creatorFeeBps: 0,
      autoResolve: true,
      timeframeSecs: tf.secs,
      strikePrice: Math.round(strikePrice * 100),
      priceFeed: sym.feed,
      resolveAt: new Date(resolveAt * 1000),
      seedOrderIds: JSON.stringify(seedOrderIds),
    } as any);

    log.info(`Created ${sym.name} ${tf.label} market: ${marketPDA.toBase58()} strike=$${strikePrice.toFixed(2)}`);
  }
}

export const autoMarketSchedulerService = new AutoMarketSchedulerService();
