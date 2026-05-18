import { DataTypes, Model, Optional } from 'sequelize';
import { sequelize } from '../config/database';

export interface CommentAttributes {
  id: number;
  marketId: number;
  walletAddress: string;
  text: string;
  stars: number;
  reportCount: number;
  status: 'active' | 'reported' | 'removed';
  createdAt: Date;
  updatedAt: Date;
}

interface CommentCreationAttributes extends Optional<CommentAttributes, 'id' | 'stars' | 'reportCount' | 'status' | 'createdAt' | 'updatedAt'> {}

export class Comment extends Model<CommentAttributes, CommentCreationAttributes> implements CommentAttributes {
  public id!: number;
  public marketId!: number;
  public walletAddress!: string;
  public text!: string;
  public stars!: number;
  public reportCount!: number;
  public status!: 'active' | 'reported' | 'removed';
  public createdAt!: Date;
  public updatedAt!: Date;
}

Comment.init(
  {
    id: {
      type: DataTypes.BIGINT,
      autoIncrement: true,
      primaryKey: true,
    },
    marketId: {
      type: DataTypes.BIGINT,
      allowNull: false,
      field: 'market_id',
    },
    walletAddress: {
      type: DataTypes.STRING(64),
      allowNull: false,
      field: 'wallet_address',
    },
    text: {
      type: DataTypes.TEXT,
      allowNull: false,
    },
    stars: {
      type: DataTypes.INTEGER,
      allowNull: false,
      defaultValue: 0,
    },
    reportCount: {
      type: DataTypes.INTEGER,
      allowNull: false,
      defaultValue: 0,
      field: 'report_count',
    },
    status: {
      type: DataTypes.STRING(16),
      allowNull: false,
      defaultValue: 'active',
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
    tableName: 'comments',
    timestamps: true,
    underscored: true,
    indexes: [
      { fields: ['market_id'] },
      { fields: ['wallet_address'] },
      { fields: ['market_id', 'status'] },
    ],
  }
);

export interface CommentStarAttributes {
  id: number;
  commentId: number;
  walletAddress: string;
  createdAt: Date;
}

interface CommentStarCreationAttributes extends Optional<CommentStarAttributes, 'id' | 'createdAt'> {}

export class CommentStar extends Model<CommentStarAttributes, CommentStarCreationAttributes> implements CommentStarAttributes {
  public id!: number;
  public commentId!: number;
  public walletAddress!: string;
  public createdAt!: Date;
}

CommentStar.init(
  {
    id: {
      type: DataTypes.BIGINT,
      autoIncrement: true,
      primaryKey: true,
    },
    commentId: {
      type: DataTypes.BIGINT,
      allowNull: false,
      field: 'comment_id',
    },
    walletAddress: {
      type: DataTypes.STRING(64),
      allowNull: false,
      field: 'wallet_address',
    },
    createdAt: {
      type: DataTypes.DATE,
      allowNull: false,
      defaultValue: DataTypes.NOW,
      field: 'created_at',
    },
  },
  {
    sequelize,
    tableName: 'comment_stars',
    timestamps: false,
    underscored: true,
    indexes: [
      { fields: ['comment_id', 'wallet_address'], unique: true },
      { fields: ['comment_id'] },
    ],
  }
);

export interface CommentReportAttributes {
  id: number;
  commentId: number;
  walletAddress: string;
  createdAt: Date;
}

interface CommentReportCreationAttributes extends Optional<CommentReportAttributes, 'id' | 'createdAt'> {}

export class CommentReport extends Model<CommentReportAttributes, CommentReportCreationAttributes> implements CommentReportAttributes {
  public id!: number;
  public commentId!: number;
  public walletAddress!: string;
  public createdAt!: Date;
}

CommentReport.init(
  {
    id: {
      type: DataTypes.BIGINT,
      autoIncrement: true,
      primaryKey: true,
    },
    commentId: {
      type: DataTypes.BIGINT,
      allowNull: false,
      field: 'comment_id',
    },
    walletAddress: {
      type: DataTypes.STRING(64),
      allowNull: false,
      field: 'wallet_address',
    },
    createdAt: {
      type: DataTypes.DATE,
      allowNull: false,
      defaultValue: DataTypes.NOW,
      field: 'created_at',
    },
  },
  {
    sequelize,
    tableName: 'comment_reports',
    timestamps: false,
    underscored: true,
    indexes: [
      { fields: ['comment_id', 'wallet_address'], unique: true },
      { fields: ['comment_id'] },
    ],
  }
);
