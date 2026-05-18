import { DataTypes, Model, Optional } from 'sequelize';
import { sequelize } from '../config/database';

export type NotificationType = 'trade_buy' | 'trade_sell' | 'order_filled' | 'order_partially_filled' | 'order_cancelled' | 'liquidation_warning' | 'liquidation' | 'position_closed' | 'market_resolved';

export type NotificationPriority = 'low' | 'normal' | 'high' | 'urgent';

export interface NotificationAttributes {
  id: string;
  userId: string;
  type: NotificationType;
  title: string;
  message: string;
  data?: Record<string, any>; // JSON data for additional context
  priority: NotificationPriority;
  read: boolean;
  readAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}

interface NotificationCreationAttributes extends Optional<NotificationAttributes, 'id' | 'read' | 'priority' | 'readAt' | 'createdAt' | 'updatedAt'> {}

export class Notification extends Model<NotificationAttributes, NotificationCreationAttributes> implements NotificationAttributes {
  public id!: string;
  public userId!: string;
  public type!: NotificationType;
  public title!: string;
  public message!: string;
  public data!: Record<string, any>;
  public priority!: NotificationPriority;
  public read!: boolean;
  public readAt?: Date;
  public readonly createdAt!: Date;
  public readonly updatedAt!: Date;
}

Notification.init(
  {
    id: {
      type: DataTypes.UUID,
      defaultValue: DataTypes.UUIDV4,
      primaryKey: true,
    },
    userId: {
      type: DataTypes.STRING,
      allowNull: false,
      field: 'user_id',
    },
    type: {
      type: DataTypes.ENUM(
        'trade_buy',
        'trade_sell',
        'order_filled',
        'order_partially_filled',
        'order_cancelled',
        'liquidation_warning',
        'liquidation',
        'position_closed',
        'market_resolved'
      ),
      allowNull: false,
    },
    title: {
      type: DataTypes.STRING,
      allowNull: false,
    },
    message: {
      type: DataTypes.TEXT,
      allowNull: false,
    },
    data: {
      type: DataTypes.JSONB,
      allowNull: true,
      defaultValue: {},
    },
    priority: {
      type: DataTypes.ENUM('low', 'normal', 'high', 'urgent'),
      defaultValue: 'normal',
      allowNull: false,
    },
    read: {
      type: DataTypes.BOOLEAN,
      defaultValue: false,
      allowNull: false,
    },
    readAt: {
      type: DataTypes.DATE,
      allowNull: true,
      field: 'read_at',
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
    tableName: 'notifications',
    indexes: [
      { fields: ['user_id', 'read'] }, // For fetching unread notifications
      { fields: ['user_id', 'created_at'] }, // For pagination
      { fields: ['type', 'created_at'] }, // For analytics
      { fields: ['priority', 'created_at'] }, // For priority-based queries
    ],
  }
);

