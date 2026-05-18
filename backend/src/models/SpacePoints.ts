import { DataTypes, Model, Optional, literal } from 'sequelize';
import { sequelize } from '../config/database';

// Level thresholds - optimized for quick lookups
export const LEVEL_THRESHOLDS = {
  iron: 0,
  bronze: 50000,
  silver: 120000,
  gold: 250000,
  platinum: 350000,
  diamond: 500000,
} as const;

export type UserLevel = keyof typeof LEVEL_THRESHOLDS;

// Points configuration (Beta)
export const POINTS_CONFIG = {
  // Point actions
  standardTrade: 1000,          // Points per standard trade placed
  leverageTrade: 3000,          // Points per leverage trade (2-10x), flat in beta
  limitOrder: 500,              // Points per limit order placed
  referralBonus: 10000,         // Points for referring someone (flat in beta)
  referredBonus: 100,           // Points for being referred
  comment: 100,                 // Points per comment
  commentDailyCap: 3,           // Max comments earning points per day (300 pts/day)
  // Legacy (kept for backward compat)
  firstTradeBonus: 200,         // Points for first trade
  dailyLoginBonus: 10,          // Points for daily login
  tradeCompletedMultiplier: 1,  // Points per $1 traded (legacy)
} as const;

export interface SpacePointsAttributes {
  id: number;
  walletAddress: string;
  referralCode: string;
  totalPoints: number;
  referralPoints: number;
  tradingPoints: number;
  bonusPoints: number;
  level: UserLevel;
  referredBy: string | null;
  totalReferrals: number;
  totalTrades: number;
  isNewUser: boolean;
  lastDailyBonusAt: Date | null;
  dailyCommentCount: number;
  lastCommentBonusDate: string | null;
  createdAt: Date;
  updatedAt: Date;
}

interface SpacePointsCreationAttributes extends Optional<SpacePointsAttributes,
  'id' | 'totalPoints' | 'referralPoints' | 'tradingPoints' | 'bonusPoints' |
  'level' | 'referredBy' | 'totalReferrals' | 'totalTrades' | 'isNewUser' | 'lastDailyBonusAt' | 'dailyCommentCount' | 'lastCommentBonusDate' | 'createdAt' | 'updatedAt'> {}

export class SpacePoints extends Model<SpacePointsAttributes, SpacePointsCreationAttributes> implements SpacePointsAttributes {
  public id!: number;
  public walletAddress!: string;
  public referralCode!: string;
  public totalPoints!: number;
  public referralPoints!: number;
  public tradingPoints!: number;
  public bonusPoints!: number;
  public level!: UserLevel;
  public referredBy!: string | null;
  public totalReferrals!: number;
  public totalTrades!: number;
  public isNewUser!: boolean;
  public lastDailyBonusAt!: Date | null;
  public dailyCommentCount!: number;
  public lastCommentBonusDate!: string | null;
  public createdAt!: Date;
  public updatedAt!: Date;

  // Calculate level from points
  static calculateLevel(points: number): UserLevel {
    if (points >= LEVEL_THRESHOLDS.diamond) return 'diamond';
    if (points >= LEVEL_THRESHOLDS.platinum) return 'platinum';
    if (points >= LEVEL_THRESHOLDS.gold) return 'gold';
    if (points >= LEVEL_THRESHOLDS.silver) return 'silver';
    if (points >= LEVEL_THRESHOLDS.bronze) return 'bronze';
    return 'iron';
  }

  // Get next level info
  static getNextLevelInfo(currentPoints: number): { nextLevel: UserLevel | null; pointsNeeded: number; progress: number } {
    const currentLevel = this.calculateLevel(currentPoints);
    const levels: UserLevel[] = ['iron', 'bronze', 'silver', 'gold', 'platinum', 'diamond'];
    const currentIndex = levels.indexOf(currentLevel);
    
    if (currentIndex === levels.length - 1) {
      return { nextLevel: null, pointsNeeded: 0, progress: 100 };
    }

    const nextLevel = levels[currentIndex + 1];
    const currentThreshold = LEVEL_THRESHOLDS[currentLevel];
    const nextThreshold = LEVEL_THRESHOLDS[nextLevel];
    const pointsNeeded = nextThreshold - currentPoints;
    const progress = ((currentPoints - currentThreshold) / (nextThreshold - currentThreshold)) * 100;

    return { nextLevel, pointsNeeded, progress: Math.min(Math.max(progress, 0), 100) };
  }

  // Generate unique referral code
  static generateReferralCode(walletAddress: string): string {
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // Removed confusing chars like 0, O, I, 1
    const walletHash = walletAddress.slice(-4).toUpperCase();
    let randomPart = '';
    for (let i = 0; i < 4; i++) {
      randomPart += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return `${randomPart}${walletHash}`;
  }

  // Add points with automatic level update
  async addPoints(points: number, type: 'referral' | 'trading' | 'bonus'): Promise<void> {
    const fieldMap = {
      referral: 'referralPoints',
      trading: 'tradingPoints',
      bonus: 'bonusPoints',
    };

    const field = fieldMap[type];
    const newTotal = this.totalPoints + points;
    const newLevel = SpacePoints.calculateLevel(newTotal);

    await this.update({
      [field]: this[field as keyof SpacePointsAttributes] as number + points,
      totalPoints: newTotal,
      level: newLevel,
    });
  }

  // Optimized leaderboard query — sort by points DESC, trades DESC for tiebreaker
  static async getLeaderboard(limit: number = 100, offset: number = 0) {
    return this.findAll({
      attributes: ['walletAddress', 'totalPoints', 'level', 'totalReferrals', 'totalTrades'],
      order: [['totalPoints', 'DESC'], ['totalTrades', 'DESC']],
      limit,
      offset,
    });
  }

  // Get user rank — uses single raw query for optimal performance at scale
  static async getUserRank(walletAddress: string): Promise<number> {
    const user = await this.findOne({ where: { walletAddress }, attributes: ['totalPoints', 'totalTrades'] });
    if (!user) return 0;

    // Count users strictly ahead: more points, OR same points but more trades
    const [result]: any = await sequelize.query(
      `SELECT COUNT(*) AS rank FROM space_points
       WHERE total_points > :points
          OR (total_points = :points AND total_trades > :trades)`,
      {
        replacements: { points: user.totalPoints, trades: user.totalTrades },
        type: sequelize.Sequelize.QueryTypes.SELECT,
      }
    );

    return Number(result.rank) + 1;
  }
}

SpacePoints.init(
  {
    id: {
      type: DataTypes.BIGINT,
      autoIncrement: true,
      primaryKey: true,
    },
    walletAddress: {
      type: DataTypes.STRING(64),
      allowNull: false,
      unique: true,
      field: 'wallet_address',
    },
    referralCode: {
      type: DataTypes.STRING(16),
      allowNull: false,
      unique: true,
      field: 'referral_code',
    },
    totalPoints: {
      type: DataTypes.INTEGER,
      allowNull: false,
      defaultValue: 0,
      field: 'total_points',
    },
    referralPoints: {
      type: DataTypes.INTEGER,
      allowNull: false,
      defaultValue: 0,
      field: 'referral_points',
    },
    tradingPoints: {
      type: DataTypes.INTEGER,
      allowNull: false,
      defaultValue: 0,
      field: 'trading_points',
    },
    bonusPoints: {
      type: DataTypes.INTEGER,
      allowNull: false,
      defaultValue: 0,
      field: 'bonus_points',
    },
    level: {
      type: DataTypes.ENUM('iron', 'bronze', 'silver', 'gold', 'platinum', 'diamond'),
      allowNull: false,
      defaultValue: 'iron',
    },
    referredBy: {
      type: DataTypes.STRING(64),
      allowNull: true,
      field: 'referred_by',
    },
    totalReferrals: {
      type: DataTypes.INTEGER,
      allowNull: false,
      defaultValue: 0,
      field: 'total_referrals',
    },
    totalTrades: {
      type: DataTypes.INTEGER,
      allowNull: false,
      defaultValue: 0,
      field: 'total_trades',
    },
    isNewUser: {
      type: DataTypes.BOOLEAN,
      allowNull: false,
      defaultValue: true,
      field: 'is_new_user',
    },
    lastDailyBonusAt: {
      type: DataTypes.DATE,
      allowNull: true,
      field: 'last_daily_bonus_at',
    },
    dailyCommentCount: {
      type: DataTypes.INTEGER,
      allowNull: false,
      defaultValue: 0,
      field: 'daily_comment_count',
    },
    lastCommentBonusDate: {
      type: DataTypes.DATEONLY,
      allowNull: true,
      field: 'last_comment_bonus_date',
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
    tableName: 'space_points',
    timestamps: true,
    underscored: true,
    indexes: [
      // Primary lookup by wallet
      { fields: ['wallet_address'], unique: true },
      // Referral code lookup
      { fields: ['referral_code'], unique: true },
      // Leaderboard query optimization (points DESC, trades DESC tiebreaker)
      { fields: [{ name: 'total_points', order: 'DESC' }, { name: 'total_trades', order: 'DESC' }] },
      // Level-based queries
      { fields: ['level', 'total_points'] },
      // Referred by lookup
      { fields: ['referred_by'] },
    ],
  }
);
