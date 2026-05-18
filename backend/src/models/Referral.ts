import { DataTypes, Model, Optional, Op } from 'sequelize';
import { sequelize } from '../config/database';

export interface ReferralAttributes {
  id: number;
  referrerWallet: string;
  referredWallet: string;
  referralCode: string;
  pointsAwarded: number;
  status: 'pending' | 'completed' | 'expired';
  completedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

interface ReferralCreationAttributes extends Optional<ReferralAttributes, 'id' | 'pointsAwarded' | 'status' | 'completedAt' | 'createdAt' | 'updatedAt'> {}

export class Referral extends Model<ReferralAttributes, ReferralCreationAttributes> implements ReferralAttributes {
  public id!: number;
  public referrerWallet!: string;
  public referredWallet!: string;
  public referralCode!: string;
  public pointsAwarded!: number;
  public status!: 'pending' | 'completed' | 'expired';
  public completedAt!: Date | null;
  public createdAt!: Date;
  public updatedAt!: Date;

  // Static methods for optimized queries
  static async getReferralsByReferrer(walletAddress: string, limit: number = 50, offset: number = 0) {
    return this.findAndCountAll({
      where: { referrerWallet: walletAddress },
      order: [['createdAt', 'DESC']],
      limit,
      offset,
    });
  }

  static async getTotalReferralCount(walletAddress: string): Promise<number> {
    return this.count({
      where: { 
        referrerWallet: walletAddress,
        status: 'completed'
      }
    });
  }

  static async getTotalPointsFromReferrals(walletAddress: string): Promise<number> {
    const result = await this.sum('pointsAwarded', {
      where: { 
        referrerWallet: walletAddress,
        status: 'completed'
      }
    });
    return result || 0;
  }
}

Referral.init(
  {
    id: {
      type: DataTypes.BIGINT,
      autoIncrement: true,
      primaryKey: true,
    },
    referrerWallet: {
      type: DataTypes.STRING(64),
      allowNull: false,
      field: 'referrer_wallet',
    },
    referredWallet: {
      type: DataTypes.STRING(64),
      allowNull: false,
      unique: true, // One user can only be referred once
      field: 'referred_wallet',
    },
    referralCode: {
      type: DataTypes.STRING(16),
      allowNull: false,
      field: 'referral_code',
    },
    pointsAwarded: {
      type: DataTypes.INTEGER,
      allowNull: false,
      defaultValue: 0,
      field: 'points_awarded',
    },
    status: {
      type: DataTypes.ENUM('pending', 'completed', 'expired'),
      allowNull: false,
      defaultValue: 'pending',
    },
    completedAt: {
      type: DataTypes.DATE,
      allowNull: true,
      field: 'completed_at',
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
    tableName: 'referrals',
    timestamps: true,
    underscored: true,
    indexes: [
      // Index for looking up referrals by referrer (most common query)
      { fields: ['referrer_wallet'] },
      // Index for checking if user was already referred
      { fields: ['referred_wallet'], unique: true },
      // Index for referral code lookups
      { fields: ['referral_code'] },
      // Composite index for stats queries
      { fields: ['referrer_wallet', 'status'] },
    ],
  }
);
