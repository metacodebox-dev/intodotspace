import { DataTypes, Model, Optional } from 'sequelize';
import { sequelize } from '../config/database';

interface OrderAttributes {
  id: string;
  marketId: string;
  outcomeId: number;
  side: 'buy' | 'sell';
  type: 'market' | 'limit';
  price: number; // Basis points (0-10000)
  size: bigint | string; // In lamports (stored as string in DB)
  filled: bigint | string; // Amount filled in lamports (stored as string in DB)
  avgFillPrice: number | null; // Weighted average fill price in basis points
  leverage: number;
  status: 'pending' | 'open' | 'partially_filled' | 'filled' | 'cancelled';
  userId: string;
  orderId?: number; // On-chain order ID used for PDA derivation
  onChainOrder?: string; // On-chain pending order PDA address
  tokenType?: 'yes' | 'no'; // YES or NO shares - for order book separation
  createdAt: Date;
  updatedAt: Date;
}

interface OrderCreationAttributes extends Optional<OrderAttributes, 'id' | 'filled' | 'avgFillPrice' | 'status' | 'orderId' | 'onChainOrder' | 'tokenType' | 'createdAt' | 'updatedAt'> {}

export class Order extends Model<OrderAttributes, OrderCreationAttributes> implements OrderAttributes {
  public id!: string;
  public marketId!: string;
  public outcomeId!: number;
  public side!: 'buy' | 'sell';
  public type!: 'market' | 'limit';
  public price!: number;
  public size!: bigint | string;
  public filled!: bigint | string;
  public avgFillPrice!: number | null;
  public leverage!: number;
  public status!: 'pending' | 'open' | 'partially_filled' | 'filled' | 'cancelled';
  public userId!: string;
  public orderId?: number;
  public onChainOrder?: string;
  public tokenType?: 'yes' | 'no';
  public readonly createdAt!: Date;
  public readonly updatedAt!: Date;

  // Helper methods to get BigInt values
  getSizeBigInt(): bigint {
    const value = this.getDataValue('size');
    return typeof value === 'string' ? BigInt(value) : BigInt(value || 0);
  }

  getFilledBigInt(): bigint {
    const value = this.getDataValue('filled');
    return typeof value === 'string' ? BigInt(value) : BigInt(value || 0);
  }
}

Order.init(
  {
    id: {
      type: DataTypes.UUID,
      defaultValue: DataTypes.UUIDV4,
      primaryKey: true,
    },
    marketId: {
      type: DataTypes.STRING,
      allowNull: false,
      field: 'market_id',
    },
    outcomeId: {
      type: DataTypes.INTEGER,
      allowNull: false,
      field: 'outcome_id',
    },
    side: {
      type: DataTypes.ENUM('buy', 'sell'),
      allowNull: false,
    },
    type: {
      type: DataTypes.ENUM('market', 'limit'),
      allowNull: false,
    },
    price: {
      type: DataTypes.INTEGER,
      allowNull: false, // For limit orders, required. For market orders, use current price
    },
    size: {
      type: DataTypes.BIGINT,
      allowNull: false, // In lamports
      get() {
        const value = this.getDataValue('size');
        return value ? BigInt(value) : BigInt(0);
      },
      set(value: bigint | number | string) {
        this.setDataValue('size', value.toString());
      },
    },
    filled: {
      type: DataTypes.BIGINT,
      defaultValue: 0,
      allowNull: false,
      get() {
        const value = this.getDataValue('filled');
        return value ? BigInt(value) : BigInt(0);
      },
      set(value: bigint | number | string) {
        this.setDataValue('filled', value.toString());
      },
    },
    avgFillPrice: {
      type: DataTypes.INTEGER,
      allowNull: true,
      defaultValue: null,
      field: 'avg_fill_price',
      comment: 'Weighted average fill price in basis points',
    },
    leverage: {
      type: DataTypes.INTEGER,
      allowNull: false,
      defaultValue: 1,
    },
    status: {
      type: DataTypes.ENUM('pending', 'open', 'partially_filled', 'filled', 'cancelled'),
      defaultValue: 'pending',
      allowNull: false,
    },
    userId: {
      type: DataTypes.STRING,
      allowNull: false,
      field: 'user_id',
    },
    orderId: {
      type: DataTypes.BIGINT,
      allowNull: true,
      field: 'order_id',
      comment: 'On-chain order ID used for PDA derivation (Date.now() timestamp)',
    },
    onChainOrder: {
      type: DataTypes.STRING,
      allowNull: true,
      field: 'on_chain_order',
      comment: 'On-chain pending order PDA address',
    },
    tokenType: {
      type: DataTypes.STRING(3),
      allowNull: true,
      defaultValue: 'yes',
      field: 'token_type',
      comment: 'YES or NO shares - separates YES and NO order books for same outcome',
    },
    createdAt: {
      type: DataTypes.DATE,
      allowNull: false,
      defaultValue: DataTypes.NOW,
      field: 'created_at',
    },
    updatedAt: {
      type: DataTypes.DATE,
      allowNull: false,
      defaultValue: DataTypes.NOW,
      field: 'updated_at',
    },
  },
  {
    sequelize,
    tableName: 'orders',
    indexes: [
      { fields: ['market_id', 'outcome_id', 'status'] },
      { fields: ['market_id', 'outcome_id', 'token_type', 'status'] }, // For YES/NO order book queries
      { fields: ['user_id'] },
      { fields: ['status', 'type', 'side', 'price'] }, // For order book queries
    ],
  }
);

