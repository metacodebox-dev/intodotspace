import { DataTypes, Model, Optional } from 'sequelize';
import { sequelize } from '../config/database';

export interface CompetitionPointSnapshotAttributes {
  id: number;
  competitionId: number;
  walletAddress: string;
  pointsAtStart: number;
  createdAt: Date;
}

interface CompetitionPointSnapshotCreationAttributes extends Optional<CompetitionPointSnapshotAttributes,
  'id' | 'createdAt'> {}

export class CompetitionPointSnapshot extends Model<CompetitionPointSnapshotAttributes, CompetitionPointSnapshotCreationAttributes> implements CompetitionPointSnapshotAttributes {
  public id!: number;
  public competitionId!: number;
  public walletAddress!: string;
  public pointsAtStart!: number;
  public createdAt!: Date;
}

CompetitionPointSnapshot.init(
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
    walletAddress: {
      type: DataTypes.STRING(64),
      allowNull: false,
      field: 'wallet_address',
    },
    pointsAtStart: {
      type: DataTypes.BIGINT,
      allowNull: false,
      defaultValue: 0,
      field: 'points_at_start',
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
    tableName: 'competition_point_snapshots',
    timestamps: false,
    underscored: true,
    indexes: [
      { fields: ['competition_id'] },
      { fields: ['competition_id', 'wallet_address'], unique: true },
    ],
  }
);
