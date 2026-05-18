/**
 * Beta Access Model
 * 
 * Sequelize model for beta access audit table.
 * Used for logging successful redemptions, not for access control.
 * Access control is managed via Redis for speed.
 */

import { DataTypes, Model, Optional } from 'sequelize';
import { sequelize } from '../config/database';

interface BetaAccessAttributes {
  id: number;
  code: string;
  codeNormalized: string;
  walletAddress: string;
  redeemedAt: Date;
  ipHash: string | null;
  tokenHash: string | null;
  tokenExpiresAt: Date | null;
  createdAt: Date;
}

interface BetaAccessCreationAttributes extends Optional<BetaAccessAttributes, 'id' | 'redeemedAt' | 'createdAt' | 'ipHash' | 'tokenHash' | 'tokenExpiresAt'> {}

class BetaAccess extends Model<BetaAccessAttributes, BetaAccessCreationAttributes> implements BetaAccessAttributes {
  public id!: number;
  public code!: string;
  public codeNormalized!: string;
  public walletAddress!: string;
  public redeemedAt!: Date;
  public ipHash!: string | null;
  public tokenHash!: string | null;
  public tokenExpiresAt!: Date | null;
  public createdAt!: Date;

  /**
   * Log a successful beta code redemption
   */
  static async logRedemption(params: {
    code: string;
    codeNormalized: string;
    walletAddress: string;
    ipHash?: string;
    tokenHash?: string;
    tokenExpiresAt?: Date;
  }): Promise<BetaAccess | null> {
    try {
      return await BetaAccess.create({
        code: params.code,
        codeNormalized: params.codeNormalized,
        walletAddress: params.walletAddress.toLowerCase(),
        ipHash: params.ipHash || null,
        tokenHash: params.tokenHash || null,
        tokenExpiresAt: params.tokenExpiresAt || null,
      });
    } catch (error: any) {
      // Ignore duplicate key errors (already logged)
      if (error.name === 'SequelizeUniqueConstraintError') {
        return null;
      }
      throw error;
    }
  }

  /**
   * Check if a code has been logged (for audit verification)
   */
  static async isCodeLogged(codeNormalized: string): Promise<boolean> {
    const count = await BetaAccess.count({
      where: { codeNormalized },
    });
    return count > 0;
  }

  /**
   * Check if a wallet has been logged (for audit verification)
   */
  static async isWalletLogged(walletAddress: string): Promise<boolean> {
    const count = await BetaAccess.count({
      where: { walletAddress: walletAddress.toLowerCase() },
    });
    return count > 0;
  }

  /**
   * Get redemption stats for monitoring
   */
  static async getStats(): Promise<{
    totalRedemptions: number;
    todayRedemptions: number;
    lastRedemption: Date | null;
  }> {
    const totalRedemptions = await BetaAccess.count();
    
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    
    const todayRedemptions = await BetaAccess.count({
      where: {
        redeemedAt: {
          [Symbol.for('gte')]: today,
        },
      },
    });

    const last = await BetaAccess.findOne({
      order: [['redeemedAt', 'DESC']],
    });

    return {
      totalRedemptions,
      todayRedemptions,
      lastRedemption: last?.redeemedAt || null,
    };
  }
}

BetaAccess.init(
  {
    id: {
      type: DataTypes.INTEGER,
      autoIncrement: true,
      primaryKey: true,
    },
    code: {
      type: DataTypes.STRING(32),
      allowNull: false,
    },
    codeNormalized: {
      type: DataTypes.STRING(32),
      allowNull: false,
      unique: true,
      field: 'code_normalized',
    },
    walletAddress: {
      type: DataTypes.STRING(64),
      allowNull: false,
      unique: true,
      field: 'wallet_address',
    },
    redeemedAt: {
      type: DataTypes.DATE,
      defaultValue: DataTypes.NOW,
      field: 'redeemed_at',
    },
    ipHash: {
      type: DataTypes.STRING(32),
      allowNull: true,
      field: 'ip_hash',
    },
    tokenHash: {
      type: DataTypes.STRING(128),
      allowNull: true,
      field: 'token_hash',
    },
    tokenExpiresAt: {
      type: DataTypes.DATE,
      allowNull: true,
      field: 'token_expires_at',
    },
    createdAt: {
      type: DataTypes.DATE,
      defaultValue: DataTypes.NOW,
      field: 'created_at',
    },
  },
  {
    sequelize,
    tableName: 'beta_access',
    timestamps: false, // We manage timestamps manually
    indexes: [
      { fields: ['wallet_address'] },
      { fields: ['redeemed_at'] },
      { fields: ['code_normalized'] },
    ],
  }
);

export { BetaAccess };
