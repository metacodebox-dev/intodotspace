import { DataTypes, Model, Optional } from 'sequelize';
import { sequelize } from '../config/database';

export type CompetitionStatus = 'upcoming' | 'live' | 'ended';

export interface CompetitionAttributes {
  id: number;
  name: string;
  description: string | null;
  prizePool: string;
  rewardBreakdown: string | null;
  status: CompetitionStatus;
  startDate: Date;
  endDate: Date;
  createdBy: string | null;
  createdAt: Date;
  updatedAt: Date;
}

interface CompetitionCreationAttributes extends Optional<CompetitionAttributes,
  'id' | 'description' | 'rewardBreakdown' | 'status' | 'createdBy' | 'createdAt' | 'updatedAt'> {}

export class Competition extends Model<CompetitionAttributes, CompetitionCreationAttributes> implements CompetitionAttributes {
  public id!: number;
  public name!: string;
  public description!: string | null;
  public prizePool!: string;
  public rewardBreakdown!: string | null;
  public status!: CompetitionStatus;
  public startDate!: Date;
  public endDate!: Date;
  public createdBy!: string | null;
  public createdAt!: Date;
  public updatedAt!: Date;

  // Associations (populated via include)
  public rewards?: any[];
  public leaderboard?: any[];
}

Competition.init(
  {
    id: {
      type: DataTypes.BIGINT,
      autoIncrement: true,
      primaryKey: true,
    },
    name: {
      type: DataTypes.STRING(255),
      allowNull: false,
    },
    description: {
      type: DataTypes.TEXT,
      allowNull: true,
    },
    prizePool: {
      type: DataTypes.STRING(100),
      allowNull: false,
      field: 'prize_pool',
    },
    rewardBreakdown: {
      type: DataTypes.STRING(255),
      allowNull: true,
      field: 'reward_breakdown',
    },
    status: {
      type: DataTypes.STRING(20),
      allowNull: false,
      defaultValue: 'upcoming',
    },
    startDate: {
      type: DataTypes.DATE,
      allowNull: false,
      field: 'start_date',
    },
    endDate: {
      type: DataTypes.DATE,
      allowNull: false,
      field: 'end_date',
    },
    createdBy: {
      type: DataTypes.STRING(100),
      allowNull: true,
      field: 'created_by',
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
    tableName: 'competitions',
    timestamps: true,
    underscored: true,
    indexes: [
      { fields: ['status'] },
      { fields: ['start_date', 'end_date'] },
    ],
  }
);
