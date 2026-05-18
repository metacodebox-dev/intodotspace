import { DataTypes, Model, Optional } from 'sequelize';
import { sequelize } from '../config/database';

export interface CompetitionLeaderboardAttributes {
  id: number;
  competitionId: number;
  rank: number;
  walletAddress: string;
  username: string | null;
  points: number;
  reward: string | null;
  createdAt: Date;
}

interface CompetitionLeaderboardCreationAttributes extends Optional<CompetitionLeaderboardAttributes,
  'id' | 'username' | 'reward' | 'createdAt'> {}

export class CompetitionLeaderboard extends Model<CompetitionLeaderboardAttributes, CompetitionLeaderboardCreationAttributes> implements CompetitionLeaderboardAttributes {
  public id!: number;
  public competitionId!: number;
  public rank!: number;
  public walletAddress!: string;
  public username!: string | null;
  public points!: number;
  public reward!: string | null;
  public createdAt!: Date;
}

CompetitionLeaderboard.init(
  {
    id: {
      type: DataTypes.BIGINT,
      autoIncrement: true,
      primaryKey: true,
    },
    competitionId: {
      type: DataTypes.BIGINT,
      allowNull: false,
      field: 'competition_id',
      references: {
        model: 'competitions',
        key: 'id',
      },
      onDelete: 'CASCADE',
    },
    rank: {
      type: DataTypes.INTEGER,
      allowNull: false,
    },
    walletAddress: {
      type: DataTypes.STRING(100),
      allowNull: false,
      field: 'wallet_address',
    },
    username: {
      type: DataTypes.STRING(100),
      allowNull: true,
    },
    points: {
      type: DataTypes.BIGINT,
      allowNull: false,
      defaultValue: 0,
    },
    reward: {
      type: DataTypes.STRING(255),
      allowNull: true,
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
    tableName: 'competition_leaderboard',
    timestamps: false,
    underscored: true,
    indexes: [
      { fields: ['competition_id'] },
      { fields: ['competition_id', 'rank'], unique: true },
    ],
  }
);
