import { DataTypes, Model, Optional } from 'sequelize';
import { sequelize } from '../config/database';

export interface FaucetClaimAttributes {
  id: number;
  walletAddress: string;
  claimType: 'usdc' | 'sol' | 'space';
  amount: number;
  txSignature: string | null;
  status: 'pending' | 'completed' | 'failed';
  claimedAt: Date;
  createdAt: Date;
  updatedAt: Date;
}

interface FaucetClaimCreationAttributes extends Optional<FaucetClaimAttributes, 'id' | 'claimType' | 'amount' | 'txSignature' | 'status' | 'claimedAt' | 'createdAt' | 'updatedAt'> {}

export class FaucetClaim extends Model<FaucetClaimAttributes, FaucetClaimCreationAttributes> implements FaucetClaimAttributes {
  public id!: number;
  public walletAddress!: string;
  public claimType!: 'usdc' | 'sol' | 'space';
  public amount!: number;
  public txSignature!: string | null;
  public status!: 'pending' | 'completed' | 'failed';
  public claimedAt!: Date;
  public createdAt!: Date;
  public updatedAt!: Date;

  /**
   * Get the most recent successful claim for a wallet address
   */
  static async getLastClaim(walletAddress: string, claimType: 'usdc' | 'sol' | 'space' = 'usdc'): Promise<FaucetClaim | null> {
    return this.findOne({
      where: {
        walletAddress,
        claimType,
        status: 'completed',
      },
      order: [['claimedAt', 'DESC']],
    });
  }

  /**
   * Check if user can claim (no successful claim in last 24 hours)
   */
  static async canClaim(walletAddress: string, claimType: 'usdc' | 'sol' | 'space' = 'usdc'): Promise<{ canClaim: boolean; nextClaimAt: Date | null }> {
    const lastClaim = await this.getLastClaim(walletAddress, claimType);

    if (!lastClaim) {
      return { canClaim: true, nextClaimAt: null };
    }

    const twentyFourHoursAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const canClaim = new Date(lastClaim.claimedAt) < twentyFourHoursAgo;
    const nextClaimAt = canClaim ? null : new Date(new Date(lastClaim.claimedAt).getTime() + 24 * 60 * 60 * 1000);

    return { canClaim, nextClaimAt };
  }
}

FaucetClaim.init(
  {
    id: {
      type: DataTypes.BIGINT,
      autoIncrement: true,
      primaryKey: true,
    },
    walletAddress: {
      type: DataTypes.STRING(64),
      allowNull: false,
      field: 'wallet_address',
    },
    claimType: {
      type: DataTypes.STRING(10),
      allowNull: false,
      defaultValue: 'usdc',
      field: 'claim_type',
    },
    amount: {
      type: DataTypes.BIGINT,
      allowNull: false,
      defaultValue: 500_000_000,
      field: 'amount',
    },
    txSignature: {
      type: DataTypes.STRING(128),
      allowNull: true,
      field: 'tx_signature',
    },
    status: {
      type: DataTypes.ENUM('pending', 'completed', 'failed'),
      allowNull: false,
      defaultValue: 'completed',
    },
    claimedAt: {
      type: DataTypes.DATE,
      allowNull: false,
      defaultValue: DataTypes.NOW,
      field: 'claimed_at',
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
    tableName: 'faucet_claims',
    timestamps: true,
    underscored: true,
    indexes: [
      { fields: ['wallet_address', 'claim_type', 'claimed_at'] },
    ],
  }
);
