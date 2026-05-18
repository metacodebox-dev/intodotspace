import { DataTypes, Model, Optional } from 'sequelize';
import { sequelize } from '../config/database';

export interface CompetitionRewardAttributes {
  id: number;
  competitionId: number;
  rank: number;
  reward: string;
  createdAt: Date;
}

interface CompetitionRewardCreationAttributes extends Optional<CompetitionRewardAttributes,
  'id' | 'createdAt'> {}

export class CompetitionReward extends Model<CompetitionRewardAttributes, CompetitionRewardCreationAttributes> implements CompetitionRewardAttributes {
  public id!: number;
  public competitionId!: number;
  public rank!: number;
  public reward!: string;
  public createdAt!: Date;
}

CompetitionReward.init(
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
    reward: {
      type: DataTypes.STRING(255),
      allowNull: false,
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
    tableName: 'competition_rewards',
    timestamps: false,
    underscored: true,
    indexes: [
      { fields: ['competition_id'] },
      { fields: ['competition_id', 'rank'], unique: true },
    ],
  }
);
