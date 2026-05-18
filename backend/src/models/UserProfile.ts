import { DataTypes, Model, Optional } from 'sequelize';
import { sequelize } from '../config/database';

export interface UserProfileAttributes {
  id: number;
  walletAddress: string;
  twitterId: string | null;
  twitterUsername: string | null;
  twitterName: string | null;
  twitterAvatarUrl: string | null;
  createdAt: Date;
  updatedAt: Date;
}

interface UserProfileCreationAttributes extends Optional<UserProfileAttributes, 'id' | 'twitterId' | 'twitterUsername' | 'twitterName' | 'twitterAvatarUrl' | 'createdAt' | 'updatedAt'> {}

export class UserProfile extends Model<UserProfileAttributes, UserProfileCreationAttributes> implements UserProfileAttributes {
  public id!: number;
  public walletAddress!: string;
  public twitterId!: string | null;
  public twitterUsername!: string | null;
  public twitterName!: string | null;
  public twitterAvatarUrl!: string | null;
  public createdAt!: Date;
  public updatedAt!: Date;
}

UserProfile.init(
  {
    id: {
      type: DataTypes.INTEGER,
      autoIncrement: true,
      primaryKey: true,
    },
    walletAddress: {
      type: DataTypes.STRING(64),
      allowNull: false,
      unique: true,
      field: 'wallet_address',
    },
    twitterId: {
      type: DataTypes.STRING(64),
      allowNull: true,
      field: 'twitter_id',
    },
    twitterUsername: {
      type: DataTypes.STRING(64),
      allowNull: true,
      field: 'twitter_username',
    },
    twitterName: {
      type: DataTypes.STRING(128),
      allowNull: true,
      field: 'twitter_name',
    },
    twitterAvatarUrl: {
      type: DataTypes.TEXT,
      allowNull: true,
      field: 'twitter_avatar_url',
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
    tableName: 'user_profiles',
    timestamps: true,
    underscored: true,
  }
);
