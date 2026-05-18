import { DataTypes, Model, Optional } from 'sequelize';
import { sequelize } from '../config/database';

export interface PositionAttributes {
  id: string; // Primary key (PDA address)
  marketAddress: string; // Market PDA
  marketId: string; // Market ID from Market table
  user: string; // User public key
  outcomeId: number; // Outcome ID (0, 1, 2, ...)
  side: number; // 0 = Long, 1 = Short
  positionType: number; // 0 = Spot, 1 = Leveraged
  shares: string; // BigInt as string (in lamports)
  avgEntryPrice: number; // Average entry price in basis points
  leverage: number; // Leverage multiplier (1 for spot)
  collateral: string; // Collateral amount in lamports
  borrowedAmount: string; // Borrowed amount in lamports (0 for spot)
  liquidationPrice?: number; // Liquidation price in basis points (only for leveraged)
  isOpen: boolean; // Whether position is currently open
  tokenType: string; // 'yes' or 'no' — which token the position holds
  realizedPnl?: string | null; // Realized PnL in USDC (as string) when position was closed. NULL for open positions.
  redeemedShares?: string | null; // Shares (6-decimal lamports as string) the user redeemed at market resolution. Persists after `shares` is zeroed by the redemption flow so the resolved-positions tab can still display historical payouts. NULL = never redeemed.
  lastUpdated: Date; // Last time position was updated
  createdAt?: Date;
  updatedAt?: Date;
}

interface PositionCreationAttributes extends Optional<PositionAttributes, 'id' | 'tokenType' | 'liquidationPrice' | 'isOpen' | 'realizedPnl' | 'redeemedShares' | 'lastUpdated' | 'createdAt' | 'updatedAt'> {}

export class Position extends Model<PositionAttributes, PositionCreationAttributes> implements PositionAttributes {
  public id!: string;
  public marketAddress!: string;
  public marketId!: string;
  public user!: string;
  public outcomeId!: number;
  public side!: number;
  public positionType!: number;
  public shares!: string;
  public avgEntryPrice!: number;
  public leverage!: number;
  public collateral!: string;
  public borrowedAmount!: string;
  public liquidationPrice?: number;
  public isOpen!: boolean;
  public tokenType!: string;
  public realizedPnl?: string | null;
  public redeemedShares?: string | null;
  public lastUpdated!: Date;
  public readonly createdAt!: Date;
  public readonly updatedAt!: Date;
}

Position.init(
  {
    id: {
      type: DataTypes.STRING,
      primaryKey: true,
    },
    marketAddress: {
      type: DataTypes.STRING,
      allowNull: false,
      field: 'market_address',
      index: true,
    },
    marketId: {
      type: DataTypes.STRING,
      allowNull: false,
      field: 'market_id',
      index: true,
    },
    user: {
      type: DataTypes.STRING,
      allowNull: false,
      index: true,
    },
    outcomeId: {
      type: DataTypes.INTEGER,
      allowNull: false,
      field: 'outcome_id',
    },
    side: {
      type: DataTypes.INTEGER,
      allowNull: false,
      comment: '0 = Long, 1 = Short',
    },
    positionType: {
      type: DataTypes.INTEGER,
      allowNull: false,
      field: 'position_type',
      comment: '0 = Spot, 1 = Leveraged',
    },
    shares: {
      type: DataTypes.STRING,
      allowNull: false,
      comment: 'Shares in lamports (BigInt as string)',
    },
    avgEntryPrice: {
      type: DataTypes.INTEGER,
      allowNull: false,
      field: 'avg_entry_price',
      comment: 'Average entry price in basis points',
    },
    leverage: {
      type: DataTypes.INTEGER,
      allowNull: false,
      defaultValue: 1,
    },
    collateral: {
      type: DataTypes.STRING,
      allowNull: false,
      comment: 'Collateral in lamports (BigInt as string)',
    },
    borrowedAmount: {
      type: DataTypes.STRING,
      allowNull: false,
      field: 'borrowed_amount',
      defaultValue: '0',
      comment: 'Borrowed amount in lamports (BigInt as string)',
    },
    liquidationPrice: {
      type: DataTypes.INTEGER,
      allowNull: true,
      field: 'liquidation_price',
      comment: 'Liquidation price in basis points (only for leveraged positions)',
    },
    tokenType: {
      type: DataTypes.STRING(4),
      allowNull: false,
      field: 'token_type',
      defaultValue: 'yes',
      comment: 'yes or no — which token the position holds',
    },
    isOpen: {
      type: DataTypes.BOOLEAN,
      allowNull: false,
      field: 'is_open',
      defaultValue: true,
    },
    realizedPnl: {
      type: DataTypes.STRING,
      allowNull: true,
      field: 'realized_pnl',
      comment: 'Realized PnL in USDC (as string) when position was closed. NULL for open positions.',
    },
    redeemedShares: {
      type: DataTypes.STRING,
      allowNull: true,
      field: 'redeemed_shares',
      comment: 'Shares (6-dec base units, BigInt-as-string) redeemed at market resolution. Survives `shares` being zeroed so the resolved tab can show historical payouts.',
    },
    lastUpdated: {
      type: DataTypes.DATE,
      allowNull: false,
      field: 'last_updated',
      defaultValue: DataTypes.NOW,
    },
    createdAt: {
      type: DataTypes.DATE,
      allowNull: false,
      field: 'created_at',
      defaultValue: DataTypes.NOW,
    },
    updatedAt: {
      type: DataTypes.DATE,
      allowNull: false,
      field: 'updated_at',
      defaultValue: DataTypes.NOW,
    },
  },
  {
    sequelize,
    tableName: 'positions',
    underscored: false, // We're manually mapping fields, so don't auto-convert
    indexes: [
      {
        name: 'idx_positions_user',
        fields: ['user'],
      },
      {
        name: 'idx_positions_market',
        fields: ['market_address'],
      },
      {
        name: 'idx_positions_user_market',
        fields: ['user', 'market_address'],
      },
      {
        name: 'idx_positions_user_open',
        fields: ['user', 'is_open'],
      },
    ],
  }
);

// Association with Market (optional, for joins)
// Note: Associations are typically set up in the models/index.ts file to avoid circular dependencies
// This association will be set up there after both models are loaded

