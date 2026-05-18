import { SpacePoints, POINTS_CONFIG, LEVEL_THRESHOLDS, UserLevel } from '../models/SpacePoints';
import { Referral } from '../models/Referral';
import { UserProfile } from '../models/UserProfile';
import { Op, Transaction } from 'sequelize';
import { sequelize } from '../config/database';

export interface UserPointsInfo {
  walletAddress: string;
  referralCode: string;
  totalPoints: number;
  referralPoints: number;
  tradingPoints: number;
  bonusPoints: number;
  level: UserLevel;
  totalReferrals: number;
  totalTrades: number;
  isNewUser: boolean;
  nextLevel: UserLevel | null;
  pointsToNextLevel: number;
  levelProgress: number;
  rank?: number;
}

export interface ReferralInfo {
  id: number;
  referredWallet: string;
  pointsAwarded: number;
  status: string;
  createdAt: Date;
  completedAt: Date | null;
}

export interface ReferralStats {
  totalReferrals: number;
  completedReferrals: number;
  pendingReferrals: number;
  totalPointsEarned: number;
  referrals: ReferralInfo[];
}

export interface LeaderboardEntry {
  rank: number;
  walletAddress: string;
  totalPoints: number;
  level: UserLevel;
  totalReferrals: number;
  totalTrades: number;
  username: string | null;
  avatarUrl: string | null;
}

class ReferralService {
  /**
   * Generate referral code from username (sanitized)
   */
  private generateUsernameCode(username: string): string {
    // Remove @ if present, make uppercase, remove special chars
    const sanitized = username.replace(/^@/, '').replace(/[^a-zA-Z0-9]/g, '').toUpperCase();
    // Limit to 16 chars
    return sanitized.slice(0, 16) || SpacePoints.generateReferralCode(username);
  }

  /**
   * Check if a referral code is available (not taken by another user)
   */
  private async isCodeAvailable(code: string, excludeWallet?: string): Promise<boolean> {
    const existing = await SpacePoints.findOne({ 
      where: { 
        referralCode: code,
        ...(excludeWallet ? { walletAddress: { [Op.ne]: excludeWallet } } : {})
      } 
    });
    return !existing;
  }

  /**
   * Get or create user points record
   * Called when user first signs in or connects wallet
   */
  async getOrCreateUserPoints(walletAddress: string): Promise<UserPointsInfo> {
    let userPoints = await SpacePoints.findOne({ where: { walletAddress } });

    // Check if user has Twitter username
    const userProfile = await UserProfile.findOne({ where: { walletAddress } });
    const twitterUsername = userProfile?.twitterUsername;

    if (!userPoints) {
      // Generate referral code - prefer Twitter username if available
      let referralCode: string;
      if (twitterUsername) {
        const usernameCode = this.generateUsernameCode(twitterUsername);
        const isAvailable = await this.isCodeAvailable(usernameCode);
        referralCode = isAvailable ? usernameCode : SpacePoints.generateReferralCode(walletAddress);
      } else {
        referralCode = SpacePoints.generateReferralCode(walletAddress);
      }

      userPoints = await SpacePoints.create({
        walletAddress,
        referralCode,
        totalPoints: 0,
        referralPoints: 0,
        tradingPoints: 0,
        bonusPoints: 0,
        level: 'iron',
        totalReferrals: 0,
        isNewUser: true,
      });
    } else if (twitterUsername) {
      // If user has Twitter now but referral code is not their username, update it
      const usernameCode = this.generateUsernameCode(twitterUsername);
      if (userPoints.referralCode !== usernameCode) {
        const isAvailable = await this.isCodeAvailable(usernameCode, walletAddress);
        if (isAvailable) {
          await userPoints.update({ referralCode: usernameCode });
        }
      }
    }

    const { nextLevel, pointsNeeded, progress } = SpacePoints.getNextLevelInfo(userPoints.totalPoints);

    return {
      walletAddress: userPoints.walletAddress,
      referralCode: userPoints.referralCode,
      totalPoints: userPoints.totalPoints,
      referralPoints: userPoints.referralPoints,
      tradingPoints: userPoints.tradingPoints,
      bonusPoints: userPoints.bonusPoints,
      level: userPoints.level,
      totalReferrals: userPoints.totalReferrals,
      totalTrades: userPoints.totalTrades,
      isNewUser: userPoints.isNewUser,
      nextLevel,
      pointsToNextLevel: pointsNeeded,
      levelProgress: progress,
    };
  }

  /**
   * Apply a referral code for a new user
   * Returns points info for both referrer and referred user
   */
  async applyReferralCode(
    newUserWallet: string, 
    referralCode: string
  ): Promise<{ success: boolean; message: string; pointsEarned?: number }> {
    const transaction = await sequelize.transaction();

    try {
      // Find the referrer by code
      const referrer = await SpacePoints.findOne({ 
        where: { referralCode: referralCode.toUpperCase() },
        transaction,
        lock: Transaction.LOCK.UPDATE,
      });

      if (!referrer) {
        await transaction.rollback();
        return { success: false, message: 'Invalid referral code' };
      }

      // Can't refer yourself
      if (referrer.walletAddress === newUserWallet) {
        await transaction.rollback();
        return { success: false, message: 'Cannot use your own referral code' };
      }

      // Check if new user already has points record
      let newUser = await SpacePoints.findOne({ 
        where: { walletAddress: newUserWallet },
        transaction,
        lock: Transaction.LOCK.UPDATE,
      });

      if (newUser && newUser.referredBy) {
        await transaction.rollback();
        return { success: false, message: 'Already applied a referral code' };
      }

      // Check if referral already exists
      const existingReferral = await Referral.findOne({
        where: { referredWallet: newUserWallet },
        transaction,
      });

      if (existingReferral) {
        await transaction.rollback();
        return { success: false, message: 'Referral already applied' };
      }

      // Create or update new user record
      if (!newUser) {
        const newUserCode = SpacePoints.generateReferralCode(newUserWallet);
        newUser = await SpacePoints.create({
          walletAddress: newUserWallet,
          referralCode: newUserCode,
          referredBy: referrer.walletAddress,
          totalPoints: POINTS_CONFIG.referredBonus,
          bonusPoints: POINTS_CONFIG.referredBonus,
          isNewUser: false,
        }, { transaction });
      } else {
        await newUser.update({
          referredBy: referrer.walletAddress,
          totalPoints: newUser.totalPoints + POINTS_CONFIG.referredBonus,
          bonusPoints: newUser.bonusPoints + POINTS_CONFIG.referredBonus,
          isNewUser: false,
          level: SpacePoints.calculateLevel(newUser.totalPoints + POINTS_CONFIG.referredBonus),
        }, { transaction });
      }

      // Referrer credit is deferred until the referred user's first filled trade.
      // See creditReferrerOnFirstTrade() — called from the order keeper.
      await Referral.create({
        referrerWallet: referrer.walletAddress,
        referredWallet: newUserWallet,
        referralCode: referralCode.toUpperCase(),
        pointsAwarded: POINTS_CONFIG.referralBonus,
        status: 'pending',
        completedAt: null,
      }, { transaction });

      await transaction.commit();

      return { 
        success: true, 
        message: `Referral applied! You earned ${POINTS_CONFIG.referredBonus} SpacePoints`,
        pointsEarned: POINTS_CONFIG.referredBonus,
      };
    } catch (error) {
      await transaction.rollback();
      console.error('Error applying referral:', error);
      throw error;
    }
  }

  /**
   * Mark user as not new (after dismissing referral modal)
   */
  async markUserAsNotNew(walletAddress: string): Promise<void> {
    await SpacePoints.update(
      { isNewUser: false },
      { where: { walletAddress } }
    );
  }

  /**
   * Get user's referral statistics
   */
  async getReferralStats(walletAddress: string, limit: number = 20, offset: number = 0): Promise<ReferralStats> {
    const [totalReferrals, completedReferrals, totalPoints, referralsData] = await Promise.all([
      Referral.count({ where: { referrerWallet: walletAddress } }),
      Referral.count({ where: { referrerWallet: walletAddress, status: 'completed' } }),
      Referral.sum('pointsAwarded', { where: { referrerWallet: walletAddress, status: 'completed' } }),
      Referral.findAll({
        where: { referrerWallet: walletAddress },
        order: [['createdAt', 'DESC']],
        limit,
        offset,
      }),
    ]);

    return {
      totalReferrals,
      completedReferrals,
      pendingReferrals: totalReferrals - completedReferrals,
      totalPointsEarned: totalPoints || 0,
      referrals: referralsData.map(r => ({
        id: r.id,
        referredWallet: r.referredWallet,
        pointsAwarded: r.pointsAwarded,
        status: r.status,
        createdAt: r.createdAt,
        completedAt: r.completedAt,
      })),
    };
  }

  /**
   * Add trading points to user (legacy volume-based)
   */
  async addTradingPoints(walletAddress: string, tradeVolume: number): Promise<void> {
    const points = Math.floor(tradeVolume * POINTS_CONFIG.tradeCompletedMultiplier);
    if (points <= 0) return;

    const user = await SpacePoints.findOne({ where: { walletAddress } });
    if (!user) return;

    const newTotal = user.totalPoints + points;
    await user.update({
      totalPoints: newTotal,
      tradingPoints: user.tradingPoints + points,
      level: SpacePoints.calculateLevel(newTotal),
    });
  }

  /**
   * Award points for a standard trade (1,000 pts)
   */
  async addStandardTradePoints(walletAddress: string): Promise<void> {
    const user = await SpacePoints.findOne({ where: { walletAddress } });
    if (!user) return;

    const points = POINTS_CONFIG.standardTrade;
    const newTotal = user.totalPoints + points;
    await user.update({
      totalPoints: newTotal,
      tradingPoints: user.tradingPoints + points,
      level: SpacePoints.calculateLevel(newTotal),
    });
  }

  /**
   * Award points for a leverage trade (3,000 pts flat in beta)
   */
  async addLeverageTradePoints(walletAddress: string): Promise<void> {
    const user = await SpacePoints.findOne({ where: { walletAddress } });
    if (!user) return;

    const points = POINTS_CONFIG.leverageTrade;
    const newTotal = user.totalPoints + points;
    await user.update({
      totalPoints: newTotal,
      tradingPoints: user.tradingPoints + points,
      level: SpacePoints.calculateLevel(newTotal),
    });
  }

  /**
   * Award points for a limit order (500 pts)
   */
  async addLimitOrderPoints(walletAddress: string): Promise<void> {
    const user = await SpacePoints.findOne({ where: { walletAddress } });
    if (!user) return;

    const points = POINTS_CONFIG.limitOrder;
    const newTotal = user.totalPoints + points;
    await user.update({
      totalPoints: newTotal,
      tradingPoints: user.tradingPoints + points,
      level: SpacePoints.calculateLevel(newTotal),
    });
  }

  /**
   * Award points for a comment (100 pts, max 3/day = 300 pts/day cap)
   * Returns true if points were awarded, false if daily cap reached
   */
  async addCommentPoints(walletAddress: string): Promise<boolean> {
    const user = await SpacePoints.findOne({ where: { walletAddress } });
    if (!user) return false;

    const today = new Date().toISOString().split('T')[0]; // YYYY-MM-DD

    // Reset counter if it's a new day
    let commentCount = user.dailyCommentCount;
    if (user.lastCommentBonusDate !== today) {
      commentCount = 0;
    }

    // Check daily cap
    if (commentCount >= POINTS_CONFIG.commentDailyCap) {
      return false;
    }

    const points = POINTS_CONFIG.comment;
    const newTotal = user.totalPoints + points;
    await user.update({
      totalPoints: newTotal,
      bonusPoints: user.bonusPoints + points,
      dailyCommentCount: commentCount + 1,
      lastCommentBonusDate: today,
      level: SpacePoints.calculateLevel(newTotal),
    });

    return true;
  }

  /**
   * Claim daily login bonus
   */
  async claimDailyBonus(walletAddress: string): Promise<{ success: boolean; points?: number; message: string }> {
    const user = await SpacePoints.findOne({ where: { walletAddress } });
    if (!user) {
      return { success: false, message: 'User not found' };
    }

    const now = new Date();
    const lastBonus = user.lastDailyBonusAt;

    // Check if already claimed today
    if (lastBonus) {
      const lastBonusDate = new Date(lastBonus);
      if (
        lastBonusDate.getDate() === now.getDate() &&
        lastBonusDate.getMonth() === now.getMonth() &&
        lastBonusDate.getFullYear() === now.getFullYear()
      ) {
        return { success: false, message: 'Daily bonus already claimed today' };
      }
    }

    const newTotal = user.totalPoints + POINTS_CONFIG.dailyLoginBonus;
    await user.update({
      totalPoints: newTotal,
      bonusPoints: user.bonusPoints + POINTS_CONFIG.dailyLoginBonus,
      lastDailyBonusAt: now,
      level: SpacePoints.calculateLevel(newTotal),
    });

    return { 
      success: true, 
      points: POINTS_CONFIG.dailyLoginBonus,
      message: `Claimed ${POINTS_CONFIG.dailyLoginBonus} daily SpacePoints!` 
    };
  }

  /**
   * Get leaderboard with pagination
   */
  async getLeaderboard(limit: number = 100, offset: number = 0): Promise<LeaderboardEntry[]> {
    const users = await SpacePoints.findAll({
      attributes: ['walletAddress', 'totalPoints', 'level', 'totalReferrals', 'totalTrades'],
      order: [['totalPoints', 'DESC'], ['totalTrades', 'DESC']],
      limit,
      offset,
    });

    // Batch fetch user profiles for efficiency
    const walletAddresses = users.map(u => u.walletAddress);
    const profiles = await UserProfile.findAll({
      where: { walletAddress: walletAddresses },
      attributes: ['walletAddress', 'twitterUsername', 'twitterAvatarUrl'],
    });

    // Create a map for O(1) lookup
    const profileMap = new Map(
      profiles.map(p => [p.walletAddress, { 
        username: p.twitterUsername, 
        avatarUrl: p.twitterAvatarUrl 
      }])
    );

    return users.map((user, index) => {
      const profile = profileMap.get(user.walletAddress);
      return {
        rank: offset + index + 1,
        walletAddress: user.walletAddress,
        totalPoints: user.totalPoints,
        level: user.level,
        totalReferrals: user.totalReferrals,
        totalTrades: user.totalTrades,
        username: profile?.username || null,
        avatarUrl: profile?.avatarUrl || null,
      };
    });
  }

  /**
   * Get user rank in leaderboard
   */
  async getUserRank(walletAddress: string): Promise<number> {
    return SpacePoints.getUserRank(walletAddress);
  }

  /**
   * Validate referral code exists
   */
  async validateReferralCode(code: string): Promise<{ valid: boolean; referrerWallet?: string }> {
    const referrer = await SpacePoints.findOne({
      where: { referralCode: code.toUpperCase() },
      attributes: ['walletAddress'],
    });

    return {
      valid: !!referrer,
      referrerWallet: referrer?.walletAddress,
    };
  }

  /**
   * Get level thresholds for UI
   */
  getLevelThresholds() {
    return LEVEL_THRESHOLDS;
  }

  /**
   * Get points configuration for UI
   */
  getPointsConfig() {
    return POINTS_CONFIG;
  }

  /**
   * Increment trade count for a user (called when order is filled)
   * Uses atomic increment for concurrency safety at scale
   */
  async incrementTradeCount(walletAddress: string, count: number = 1): Promise<void> {
    await SpacePoints.increment('totalTrades', {
      by: count,
      where: { walletAddress },
    });
  }

  /**
   * Credit the referrer when the referred user completes their first trade.
   * Idempotent: a conditional UPDATE on status='pending' ensures only one caller
   * wins under concurrent fills, so the referrer is credited at most once.
   */
  async creditReferrerOnFirstTrade(tradedWallet: string): Promise<boolean> {
    const pending = await Referral.findOne({
      where: { referredWallet: tradedWallet, status: 'pending' },
    });
    if (!pending) return false;

    const transaction = await sequelize.transaction();
    try {
      const [claimed] = await Referral.update(
        { status: 'completed', completedAt: new Date() },
        { where: { id: pending.id, status: 'pending' }, transaction },
      );
      if (claimed === 0) {
        await transaction.commit();
        return false;
      }

      const referrer = await SpacePoints.findOne({
        where: { walletAddress: pending.referrerWallet },
        transaction,
        lock: Transaction.LOCK.UPDATE,
      });
      if (!referrer) {
        await transaction.commit();
        return false;
      }

      const newReferrerPoints = referrer.totalPoints + POINTS_CONFIG.referralBonus;
      await referrer.update({
        totalPoints: newReferrerPoints,
        referralPoints: referrer.referralPoints + POINTS_CONFIG.referralBonus,
        totalReferrals: referrer.totalReferrals + 1,
        level: SpacePoints.calculateLevel(newReferrerPoints),
      }, { transaction });

      await transaction.commit();
      return true;
    } catch (err) {
      await transaction.rollback();
      throw err;
    }
  }

  /**
   * Get trade count for a user
   */
  async getTradeCount(walletAddress: string): Promise<number> {
    const user = await SpacePoints.findOne({
      where: { walletAddress },
      attributes: ['totalTrades'],
    });
    return user?.totalTrades || 0;
  }
}

export const referralService = new ReferralService();
