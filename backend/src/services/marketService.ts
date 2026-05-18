import { Connection, PublicKey } from '@solana/web3.js';
import { Program, AnchorProvider, Idl } from '@coral-xyz/anchor';
import { Op } from 'sequelize';
import { Market as MarketModel } from '../models/Market';
import { OrderBookService } from './orderBookService';
import { BN } from '@coral-xyz/anchor';

interface MarketOutcome {
  id: number;
  label: string;
  openInterest: string;
  lastPrice?: number; // Last traded price from order book (basis points)
  imageUrl?: string | null; // Supabase Storage URL for outcome photo
  subtitle?: string | null; // Optional subtitle (e.g., party, team)
}

interface MarketData {
  id: number;
  marketAddress: string;
  marketId: string;
  creator: string;
  title: string;
  description: string;
  imageUrl: string | null;
  category: number;
  status: number;
  endDate: Date;
  createdAt: Date;
  totalVolume: string;
  totalCollateral: string;
  totalOpenInterest: string;
  maxOpenInterest: string;
  insuranceFund: string;
  resolvedOutcome: number | null;
  resolutionSource: string | null;
  resolveSlot: string | null;
  challengeBond: string;
  challenger: string | null;
  creatorFeeBps: number;
  outcomes: MarketOutcome[];
  onChainCreatedAt: Date | null;
  lastSyncedAt: Date | null;
  autoResolve?: boolean;
  timeframeSecs?: number | null;
  strikePrice?: number | null;
  priceFeed?: string | null;
  resolveAt?: Date | null;
  quoteMint: string;
  quoteDecimals: number;
  quoteSymbol: string;
}

export class MarketService {
  private connection: Connection;
  private program: Program<Idl> | null = null;
  private orderBookService: OrderBookService;

  constructor() {
    this.connection = new Connection(
      process.env.SOLANA_RPC_URL || 'https://api.devnet.solana.com',
      {
        commitment: 'confirmed',
        wsEndpoint: process.env.SOLANA_WS_URL,
        confirmTransactionInitialTimeout: 60000,
      }
    );
    this.orderBookService = new OrderBookService();
  }

  /**
   * Store a market in the database
   */
  async storeMarket(data: {
    marketAddress: string;
    marketId: string;
    creator: string;
    title: string;
    description: string;
    imageUrl?: string | null;
    category: number;
    endDate: Date;
    outcomes: MarketOutcome[];
    initialCollateral?: string;
    onChainCreatedAt?: Date;
    quoteMint?: string;
    quoteDecimals?: number;
    quoteSymbol?: string;
  }): Promise<MarketModel> {
    const [market, created] = await MarketModel.findOrCreate({
      where: { marketAddress: data.marketAddress },
      defaults: {
        marketAddress: data.marketAddress,
        marketId: data.marketId,
        creator: data.creator,
        title: data.title,
        description: data.description,
        imageUrl: data.imageUrl || null,
        category: data.category,
        status: 0, // Active
        endDate: data.endDate,
        totalVolume: '0',
        totalCollateral: data.initialCollateral || '0',
        totalOpenInterest: '0',
        maxOpenInterest: '0',
        insuranceFund: '0',
        resolvedOutcome: null,
        resolutionSource: null,
        resolveSlot: null,
        challengeBond: '0',
        challenger: null,
        creatorFeeBps: 0,
        outcomes: JSON.stringify(data.outcomes),
        onChainCreatedAt: data.onChainCreatedAt || new Date(),
        lastSyncedAt: new Date(),
        quoteMint: data.quoteMint ?? 'CqdmbJnQxMNNTGZzsBhEPTSzH52Pwa5DRvpVjZ2Us92t',
        quoteDecimals: data.quoteDecimals ?? 6,
        quoteSymbol: data.quoteSymbol ?? 'USDC',
      },
    });

    if (!created) {
      // Update existing market
      await market.update({
        title: data.title,
        description: data.description,
        imageUrl: data.imageUrl || market.imageUrl, // Keep existing if not provided
        category: data.category,
        endDate: data.endDate,
        outcomes: JSON.stringify(data.outcomes),
        lastSyncedAt: new Date(),
      });
    }

    return market;
  }

  /**
   * Get all markets with filters
   */
  async getMarkets(filters: {
    category?: string;
    status?: string;
    search?: string;
    quoteSymbol?: string;
    limit: number;
    offset: number;
  }): Promise<{ markets: MarketData[]; total: number }> {
    const where: any = {};

    if (filters.quoteSymbol && filters.quoteSymbol.trim() !== '') {
      where.quoteSymbol = filters.quoteSymbol.toUpperCase();
    }

    if (filters.category && filters.category.trim() !== '') {
      // Map category string to number if needed
      const categoryMap: Record<string, number> = {
        crypto: 0,
        politics: 1,
        sports: 2,
        technology: 3,
        economics: 4,
        culture: 5,
      };

      // Check if category is in the map
      if (categoryMap.hasOwnProperty(filters.category)) {
        where.category = categoryMap[filters.category];
      } else {
        // Try parsing as number if it's not in the map
        const parsedCategory = parseInt(filters.category);
        if (!isNaN(parsedCategory)) {
          where.category = parsedCategory;
        }
        // If both fail, don't filter by category (ignore invalid category)
      }
    }

    if (filters.status && filters.status.trim() !== '') {
      const parsedStatus = parseInt(filters.status);
      if (!isNaN(parsedStatus)) {
        where.status = parsedStatus;
      }
      // If status is invalid, don't filter by status
    }

    if (filters.search && filters.search.trim() !== '') {
      where.title = { [Op.iLike]: `%${filters.search.trim()}%` };
    }

    const { rows: markets, count: total } = await MarketModel.findAndCountAll({
      where,
      limit: filters.limit,
      offset: filters.offset,
      order: [['createdAt', 'DESC']],
    });

    // Fast path for listings: skip live orderbook queries, use stored lastPrice.
    // Callers needing live prices should use getMarketById (which still does orderbook lookups).
    const marketsWithPrices = markets.map(m => this.mapMarketToDataFast(m));

    return { markets: marketsWithPrices, total };
  }

  /**
   * Fast mapping — no live orderbook query. Uses stored outcome lastPrice values.
   * Suitable for listing views (~40x faster than mapMarketToData for 20 markets).
   */
  private mapMarketToDataFast(market: MarketModel): MarketData {
    let parsedOutcomes: any[] = [];
    try {
      parsedOutcomes = JSON.parse(market.outcomes);
    } catch { parsedOutcomes = []; }

    const outcomesWithPrices = parsedOutcomes.map((o: any) => ({
      ...o,
      lastPrice: o.lastPrice ?? o.share_price ?? 5000,
    }));

    const totalVolumeNum = parseInt(market.totalVolume || '0', 10) || 0;

    return {
      id: market.id,
      marketAddress: market.marketAddress,
      marketId: market.marketId,
      creator: market.creator,
      title: market.title,
      description: market.description,
      imageUrl: market.imageUrl,
      category: market.category,
      status: market.status,
      endDate: market.endDate,
      createdAt: market.createdAt,
      totalVolume: totalVolumeNum.toString(),
      totalCollateral: market.totalCollateral,
      totalOpenInterest: market.totalOpenInterest,
      maxOpenInterest: market.maxOpenInterest,
      insuranceFund: market.insuranceFund,
      resolvedOutcome: market.resolvedOutcome,
      resolutionSource: market.resolutionSource,
      resolveSlot: market.resolveSlot,
      challengeBond: market.challengeBond,
      challenger: market.challenger,
      creatorFeeBps: market.creatorFeeBps,
      outcomes: outcomesWithPrices,
      onChainCreatedAt: market.onChainCreatedAt,
      lastSyncedAt: market.lastSyncedAt,
      autoResolve: market.autoResolve,
      timeframeSecs: market.timeframeSecs,
      strikePrice: market.strikePrice,
      priceFeed: market.priceFeed,
      resolveAt: market.resolveAt,
      quoteMint: market.quoteMint,
      quoteDecimals: market.quoteDecimals,
      quoteSymbol: market.quoteSymbol,
    };
  }

  /**
   * Get market by address or ID
   */
  async getMarketById(marketId: string): Promise<MarketData | null> {
    try {
      // Try as market address first
      let market = await MarketModel.findOne({
        where: { marketAddress: marketId },
      });

      // If not found, try as market_id
      if (!market) {
        market = await MarketModel.findOne({
          where: { marketId: marketId },
        });
      }

      // If still not found, try as database ID
      if (!market && !isNaN(Number(marketId))) {
        market = await MarketModel.findByPk(Number(marketId));
      }

      return market ? await this.mapMarketToData(market) : null;
    } catch (error) {
      // Logs disabled - check keeper service logs for execution details
      return null;
    }
  }

  /**
   * Sync market data from blockchain
   */
  async syncMarketFromBlockchain(marketAddress: string): Promise<MarketData | null> {
    try {
      // This would fetch from on-chain using Anchor program
      // For now, return the database version
      const market = await MarketModel.findOne({
        where: { marketAddress },
      });

      if (!market) {
        return null;
      }

      // Update lastSyncedAt
      await market.update({ lastSyncedAt: new Date() });

      return await this.mapMarketToData(market);
    } catch (error) {
      // Logs disabled - check keeper service logs for execution details
      return null;
    }
  }

  /**
   * Create market (stores in database)
   * Note: Actual on-chain creation happens in frontend
   */
  async createMarket(data: {
    marketAddress: string;
    marketId: string;
    creator: string;
    title: string;
    description: string;
    imageUrl?: string | null;
    category: number;
    endDate: Date;
    outcomes: MarketOutcome[];
    initialCollateral?: string;
    quoteMint?: string;
    quoteDecimals?: number;
    quoteSymbol?: string;
  }): Promise<MarketData> {
    const market = await this.storeMarket({
      ...data,
      onChainCreatedAt: new Date(),
    });

    return await this.mapMarketToData(market);
  }

  /**
   * Get orderbook (placeholder - would fetch from on-chain)
   */
  async getOrderBook(marketId: string, outcomeId: string) {
    // Implementation would fetch orderbook from on-chain data
    return { bids: [], asks: [], marketId, outcomeId };
  }

  /**
   * Resolve market (placeholder - would call on-chain)
   */
  async resolveMarket(marketId: string, outcomeId: string, resolutionSource: string) {
    // Update database
    const market = await MarketModel.findOne({
      where: { marketAddress: marketId },
    });

    if (!market) {
      throw new Error('Market not found');
    }

    await market.update({
      status: 1, // Resolving
      resolvedOutcome: parseInt(outcomeId),
      resolutionSource: resolutionSource,
      lastSyncedAt: new Date(),
    });

    return await this.mapMarketToData(market);
  }

  /**
   * Update market status from on-chain data
   */
  async updateMarketStatus(
    marketAddress: string,
    data: {
      status: number;
      resolvedOutcome?: number | null;
      resolutionSource?: string | null;
      resolveSlot?: string | null;
      challengeBond?: string;
      challenger?: string | null;
    }
  ): Promise<MarketData | null> {
    const market = await MarketModel.findOne({
      where: { marketAddress },
    });

    if (!market) {
      return null;
    }

    const updateData: any = {
      status: data.status,
      lastSyncedAt: new Date(),
    };

    if (data.resolvedOutcome !== undefined) {
      updateData.resolvedOutcome = data.resolvedOutcome;
    }
    if (data.resolutionSource !== undefined) {
      updateData.resolutionSource = data.resolutionSource;
    }
    if (data.resolveSlot !== undefined) {
      updateData.resolveSlot = data.resolveSlot;
    }
    if (data.challengeBond !== undefined) {
      updateData.challengeBond = data.challengeBond;
    }
    if (data.challenger !== undefined) {
      updateData.challenger = data.challenger;
    }

    await market.update(updateData);

    console.log(`[MarketService] Updated market ${marketAddress} status to ${data.status}`);
    return await this.mapMarketToData(market);
  }

  /**
   * Map database model to API response format
   * Includes calculated prices from order book for each outcome
   * For binary markets (YES/NO), NO = 10000 - YES
   */
  private async mapMarketToData(market: MarketModel): Promise<MarketData> {
    const parsedOutcomes = JSON.parse(market.outcomes);
    
    // Check if this is a binary market (2 outcomes, typically YES/NO)
    const isBinaryMarket = parsedOutcomes.length === 2;
    const yesOutcome = parsedOutcomes.find((o: any) => o.label.toLowerCase() === 'yes');
    const noOutcome = parsedOutcomes.find((o: any) => o.label.toLowerCase() === 'no');
    
    let yesPrice: number | null = null;
    
    // Calculate YES price from order book if it's a binary market
    if (isBinaryMarket && yesOutcome) {
      try {
        yesPrice = await this.orderBookService.getMarketPrice(
          market.marketAddress,
          yesOutcome.id || 0,
          'yes'
        );
      } catch (error) {
        // If price calculation fails, use stored lastPrice or default
        yesPrice = yesOutcome.lastPrice || yesOutcome.share_price || 5000;
      }
      
      // Ensure YES price is valid
      if (!yesPrice || yesPrice < 0 || yesPrice > 10000) {
        yesPrice = 5000; // Default to 50%
      }
    }
    
    // Calculate prices for each outcome
    const outcomesWithPrices = await Promise.all(
      parsedOutcomes.map(async (outcome: any) => {
        // For binary markets with YES/NO, calculate NO from YES
        if (isBinaryMarket && yesPrice !== null) {
          if (outcome.label.toLowerCase() === 'yes') {
            return {
              ...outcome,
              lastPrice: yesPrice,
            };
          } else if (outcome.label.toLowerCase() === 'no') {
            // NO = 10000 - YES (always complementary)
            return {
              ...outcome,
              lastPrice: 10000 - yesPrice,
            };
          }
        }
        
        // For multi-outcome markets or if YES price not found, calculate individually
        try {
          const price = await this.orderBookService.getMarketPrice(
            market.marketAddress,
            outcome.id || 0,
            'yes'
          );
          
          return {
            ...outcome,
            lastPrice: price || outcome.lastPrice || 5000,
          };
        } catch (error) {
          // If price calculation fails, use stored lastPrice or default
          return {
            ...outcome,
            lastPrice: outcome.lastPrice || outcome.share_price || 5000,
          };
        }
      })
    );

    // Parse totalVolume as number (it's stored as string)
    const totalVolumeNum = parseInt(market.totalVolume || '0', 10) || 0;

    return {
      id: market.id,
      marketAddress: market.marketAddress,
      marketId: market.marketId,
      creator: market.creator,
      title: market.title,
      description: market.description,
      imageUrl: market.imageUrl,
      category: market.category,
      status: market.status,
      endDate: market.endDate,
      createdAt: market.createdAt,
      totalVolume: totalVolumeNum.toString(),
      totalCollateral: market.totalCollateral,
      totalOpenInterest: market.totalOpenInterest,
      maxOpenInterest: market.maxOpenInterest,
      insuranceFund: market.insuranceFund,
      resolvedOutcome: market.resolvedOutcome,
      resolutionSource: market.resolutionSource,
      resolveSlot: market.resolveSlot,
      challengeBond: market.challengeBond,
      challenger: market.challenger,
      creatorFeeBps: market.creatorFeeBps,
      outcomes: outcomesWithPrices,
      onChainCreatedAt: market.onChainCreatedAt,
      lastSyncedAt: market.lastSyncedAt,
      autoResolve: market.autoResolve,
      timeframeSecs: market.timeframeSecs,
      strikePrice: market.strikePrice,
      priceFeed: market.priceFeed,
      resolveAt: market.resolveAt,
      quoteMint: market.quoteMint,
      quoteDecimals: market.quoteDecimals,
      quoteSymbol: market.quoteSymbol,
    };
  }
}


