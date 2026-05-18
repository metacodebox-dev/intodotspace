import { DataTypes, Model, Optional } from 'sequelize';
import { sequelize } from '../config/database';

export interface MarketAttributes {
  id: number;
  marketAddress: string; // Solana PDA address
  marketId: string; // The deterministic market_id (u64 as string)
  creator: string; // Creator's Solana public key
  title: string;
  description: string;
  imageUrl: string | null; // Market cover image URL (Supabase Storage)
  category: number; // u8 category
  status: number; // MarketStatus enum (0=Active, 1=Resolving, etc.)
  endDate: Date;
  createdAt: Date;
  totalVolume: string; // BN as string
  totalCollateral: string; // BN as string
  totalOpenInterest: string; // BN as string
  maxOpenInterest: string; // BN as string
  insuranceFund: string; // BN as string
  resolvedOutcome: number | null;
  resolutionSource: string | null; // Oracle public key
  resolveSlot: string | null; // BN as string
  challengeBond: string; // BN as string
  challenger: string | null; // Challenger public key
  creatorFeeBps: number;
  outcomes: string; // JSON string of MarketOutcome[]
  // Metadata
  onChainCreatedAt: Date | null; // When it was created on-chain
  lastSyncedAt: Date | null; // Last time we synced from blockchain
  // Auto-market fields
  autoResolve: boolean;
  timeframeSecs: number | null;     // 900 (15m) or 3600 (1h)
  strikePrice: number | null;       // Strike price in cents at creation
  priceFeed: string | null;         // "btcusdt", "ethusdt", "solusdt"
  resolveAt: Date | null;           // When the market should be resolved
  resolvedAt: Date | null;          // When resolve_market was actually called
  seedOrderIds: string | null;      // JSON of SeedOrderIds for liquidity recovery
  // Quote token (USDC or SPACE). Default USDC for backward compat.
  quoteMint: string;
  quoteDecimals: number;
  quoteSymbol: string;
}

interface MarketCreationAttributes extends Optional<MarketAttributes, 'id' | 'createdAt' | 'onChainCreatedAt' | 'lastSyncedAt' | 'imageUrl' | 'autoResolve' | 'timeframeSecs' | 'strikePrice' | 'priceFeed' | 'resolveAt' | 'resolvedAt' | 'seedOrderIds' | 'quoteMint' | 'quoteDecimals' | 'quoteSymbol'> {}

export class Market extends Model<MarketAttributes, MarketCreationAttributes> implements MarketAttributes {
  public id!: number;
  public marketAddress!: string;
  public marketId!: string;
  public creator!: string;
  public title!: string;
  public description!: string;
  public imageUrl!: string | null;
  public category!: number;
  public status!: number;
  public endDate!: Date;
  public createdAt!: Date;
  public totalVolume!: string;
  public totalCollateral!: string;
  public totalOpenInterest!: string;
  public maxOpenInterest!: string;
  public insuranceFund!: string;
  public resolvedOutcome!: number | null;
  public resolutionSource!: string | null;
  public resolveSlot!: string | null;
  public challengeBond!: string;
  public challenger!: string | null;
  public creatorFeeBps!: number;
  public outcomes!: string;
  public onChainCreatedAt!: Date | null;
  public lastSyncedAt!: Date | null;
  public autoResolve!: boolean;
  public timeframeSecs!: number | null;
  public strikePrice!: number | null;
  public priceFeed!: string | null;
  public resolveAt!: Date | null;
  public resolvedAt!: Date | null;
  public seedOrderIds!: string | null;
  public quoteMint!: string;
  public quoteDecimals!: number;
  public quoteSymbol!: string;
}

Market.init(
  {
    id: {
      type: DataTypes.INTEGER,
      autoIncrement: true,
      primaryKey: true,
    },
    marketAddress: {
      type: DataTypes.STRING,
      allowNull: false,
      unique: true,
      comment: 'Solana PDA address of the market',
    },
    marketId: {
      type: DataTypes.STRING,
      allowNull: false,
      comment: 'Deterministic market_id (u64)',
    },
    creator: {
      type: DataTypes.STRING,
      allowNull: false,
      comment: 'Creator Solana public key',
    },
    title: {
      type: DataTypes.STRING(200),
      allowNull: false,
    },
    description: {
      type: DataTypes.TEXT,
      allowNull: false,
    },
    imageUrl: {
      type: DataTypes.STRING(500),
      allowNull: true,
      field: 'image_url',
      comment: 'Market cover image URL (Supabase Storage)',
    },
    category: {
      type: DataTypes.INTEGER,
      allowNull: false,
      comment: 'Market category (u8)',
    },
    status: {
      type: DataTypes.INTEGER,
      allowNull: false,
      defaultValue: 0,
      comment: 'MarketStatus enum: 0=Active, 1=Resolving, 2=Disputed, 3=Finalized, 4=Closed',
    },
    endDate: {
      type: DataTypes.DATE,
      allowNull: false,
    },
    createdAt: {
      type: DataTypes.DATE,
      allowNull: false,
      defaultValue: DataTypes.NOW,
    },
    totalVolume: {
      type: DataTypes.STRING,
      allowNull: false,
      defaultValue: '0',
      comment: 'Total volume as string (BN)',
    },
    totalCollateral: {
      type: DataTypes.STRING,
      allowNull: false,
      defaultValue: '0',
      comment: 'Total collateral as string (BN)',
    },
    totalOpenInterest: {
      type: DataTypes.STRING,
      allowNull: false,
      defaultValue: '0',
      comment: 'Total open interest as string (BN)',
    },
    maxOpenInterest: {
      type: DataTypes.STRING,
      allowNull: false,
      defaultValue: '0',
      comment: 'Max open interest as string (BN)',
    },
    insuranceFund: {
      type: DataTypes.STRING,
      allowNull: false,
      defaultValue: '0',
      comment: 'Insurance fund as string (BN)',
    },
    resolvedOutcome: {
      type: DataTypes.INTEGER,
      allowNull: true,
      comment: 'Resolved outcome ID',
    },
    resolutionSource: {
      type: DataTypes.STRING,
      allowNull: true,
      comment: 'Oracle public key that resolved',
    },
    resolveSlot: {
      type: DataTypes.STRING,
      allowNull: true,
      comment: 'Slot when resolved (BN as string)',
    },
    challengeBond: {
      type: DataTypes.STRING,
      allowNull: false,
      defaultValue: '0',
      comment: 'Challenge bond amount (BN as string)',
    },
    challenger: {
      type: DataTypes.STRING,
      allowNull: true,
      comment: 'Challenger public key',
    },
    creatorFeeBps: {
      type: DataTypes.INTEGER,
      allowNull: false,
      defaultValue: 0,
      comment: 'Creator fee in basis points',
    },
    outcomes: {
      type: DataTypes.TEXT,
      allowNull: false,
      comment: 'JSON string of MarketOutcome array',
    },
    onChainCreatedAt: {
      type: DataTypes.DATE,
      allowNull: true,
      comment: 'When market was created on-chain',
    },
    lastSyncedAt: {
      type: DataTypes.DATE,
      allowNull: true,
      comment: 'Last time we synced from blockchain',
    },
    autoResolve: {
      type: DataTypes.BOOLEAN,
      allowNull: false,
      defaultValue: false,
      field: 'auto_resolve',
      comment: 'True for Binance-driven auto-markets',
    },
    timeframeSecs: {
      type: DataTypes.INTEGER,
      allowNull: true,
      field: 'timeframe_secs',
      comment: '900 (15m) or 3600 (1h)',
    },
    strikePrice: {
      type: DataTypes.BIGINT,
      allowNull: true,
      field: 'strike_price',
      comment: 'Strike price in cents at market creation',
    },
    priceFeed: {
      type: DataTypes.STRING(20),
      allowNull: true,
      field: 'price_feed',
      comment: 'Binance symbol: btcusdt, ethusdt, solusdt',
    },
    resolveAt: {
      type: DataTypes.DATE,
      allowNull: true,
      field: 'resolve_at',
      comment: 'Scheduled resolution time',
    },
    resolvedAt: {
      type: DataTypes.DATE,
      allowNull: true,
      field: 'resolved_at',
      comment: 'Actual time resolve_market was called',
    },
    seedOrderIds: {
      type: DataTypes.TEXT,
      allowNull: true,
      field: 'seed_order_ids',
      comment: 'JSON of admin seed order IDs for liquidity recovery',
    },
    quoteMint: {
      type: DataTypes.STRING(44),
      allowNull: false,
      defaultValue: 'CqdmbJnQxMNNTGZzsBhEPTSzH52Pwa5DRvpVjZ2Us92t',
      field: 'quote_mint',
      comment: 'Quote/collateral token mint address',
    },
    quoteDecimals: {
      type: DataTypes.SMALLINT,
      allowNull: false,
      defaultValue: 6,
      field: 'quote_decimals',
      comment: 'Decimals of the quote token (6 for USDC, 9 for SPACE)',
    },
    quoteSymbol: {
      type: DataTypes.STRING(16),
      allowNull: false,
      defaultValue: 'USDC',
      field: 'quote_symbol',
      comment: 'Display symbol: USDC, SPACE, etc.',
    },
  },
  {
    sequelize,
    tableName: 'markets',
    timestamps: true,
    updatedAt: false, // We'll use lastSyncedAt instead
  }
);






