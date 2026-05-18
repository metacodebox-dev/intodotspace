import { Competition } from '../models/Competition';
import { CompetitionReward } from '../models/CompetitionReward';
import { CompetitionLeaderboard } from '../models/CompetitionLeaderboard';
import { CompetitionPointSnapshot } from '../models/CompetitionPointSnapshot';
import { SpacePoints } from '../models/SpacePoints';
import { UserProfile } from '../models/UserProfile';
import { getRedisClient } from '../config/redis';
import { sequelize } from '../config/database';
import { QueryTypes } from 'sequelize';

const CACHE_KEYS = {
  list: 'competitions:list',
  detail: (id: number) => `competitions:${id}`,
  leaderboard: (id: number) => `competitions:${id}:leaderboard`,
};

const CACHE_TTL = {
  list: 30,
  detail: 30,
  liveLeaderboard: 60,
};

class CompetitionService {
  // --- Cache helpers ---

  private async getCache(key: string): Promise<any | null> {
    try {
      const redis = getRedisClient();
      const cached = await redis.get(key);
      return cached ? JSON.parse(cached) : null;
    } catch {
      return null;
    }
  }

  private async setCache(key: string, data: any, ttl?: number): Promise<void> {
    try {
      const redis = getRedisClient();
      if (ttl) {
        await redis.set(key, JSON.stringify(data), 'EX', ttl);
      } else {
        await redis.set(key, JSON.stringify(data));
      }
    } catch {
      // Redis unavailable, continue without cache
    }
  }

  private async invalidateCache(competitionId?: number): Promise<void> {
    try {
      const redis = getRedisClient();
      await redis.del(CACHE_KEYS.list);
      if (competitionId) {
        await redis.del(CACHE_KEYS.detail(competitionId));
        await redis.del(CACHE_KEYS.leaderboard(competitionId));
      }
    } catch {
      // Redis unavailable
    }
  }

  // --- Public API ---

  async listCompetitions(): Promise<any[]> {
    const cached = await this.getCache(CACHE_KEYS.list);
    if (cached) return cached;

    const competitions = await Competition.findAll({
      order: [['startDate', 'DESC']],
      include: [
        {
          model: CompetitionReward,
          as: 'rewards',
          attributes: ['rank', 'reward'],
          separate: true,
          order: [['rank', 'ASC']],
        },
      ],
    });

    const result = competitions.map(c => this.formatCompetition(c));
    await this.setCache(CACHE_KEYS.list, result, CACHE_TTL.list);
    return result;
  }

  async getCompetition(id: number): Promise<any | null> {
    const cached = await this.getCache(CACHE_KEYS.detail(id));
    if (cached) return cached;

    const competition = await Competition.findByPk(id, {
      include: [
        {
          model: CompetitionReward,
          as: 'rewards',
          attributes: ['rank', 'reward'],
          separate: true,
          order: [['rank', 'ASC']],
        },
      ],
    });

    if (!competition) return null;

    const result = this.formatCompetition(competition);
    await this.setCache(CACHE_KEYS.detail(id), result, CACHE_TTL.detail);
    return result;
  }

  async getCompetitionLeaderboard(id: number, limit: number = 50): Promise<any[]> {
    const cached = await this.getCache(CACHE_KEYS.leaderboard(id));
    if (cached) return cached;

    const competition = await Competition.findByPk(id);
    if (!competition) return [];

    if (competition.status === 'ended') {
      // Frozen leaderboard from competition_leaderboard table
      const entries = await CompetitionLeaderboard.findAll({
        where: { competitionId: id },
        order: [['rank', 'ASC']],
        limit,
      });

      const result = entries.map(e => ({
        rank: e.rank,
        trader: e.username || this.truncateWallet(e.walletAddress),
        walletAddress: e.walletAddress,
        points: this.formatPoints(Number(e.points)),
        reward: e.reward || '',
      }));

      // Cache ended leaderboards permanently (until invalidated)
      await this.setCache(CACHE_KEYS.leaderboard(id), result);
      return result;
    }

    if (competition.status === 'live') {
      // Live leaderboard: current points minus snapshot (competition-period only)
      const deltaUsers: { wallet_address: string; delta_points: number }[] = await sequelize.query(
        `SELECT sp.wallet_address,
                (sp.total_points - COALESCE(snap.points_at_start, 0)) AS delta_points
         FROM space_points sp
         LEFT JOIN competition_point_snapshots snap
           ON snap.wallet_address = sp.wallet_address AND snap.competition_id = :competitionId
         WHERE (sp.total_points - COALESCE(snap.points_at_start, 0)) > 0
         ORDER BY delta_points DESC, sp.total_trades DESC
         LIMIT :limit`,
        {
          replacements: { competitionId: id, limit },
          type: QueryTypes.SELECT,
        }
      );

      const walletAddresses = deltaUsers.map(u => u.wallet_address);
      const profiles = await UserProfile.findAll({
        where: { walletAddress: walletAddresses },
        attributes: ['walletAddress', 'twitterUsername'],
      });
      const profileMap = new Map(profiles.map(p => [p.walletAddress, p.twitterUsername]));

      // Get rewards config for this competition
      const rewards = await CompetitionReward.findAll({
        where: { competitionId: id },
        order: [['rank', 'ASC']],
      });
      const rewardMap = new Map(rewards.map(r => [r.rank, r.reward]));

      const result = deltaUsers.map((user, index) => ({
        rank: index + 1,
        trader: profileMap.get(user.wallet_address) || this.truncateWallet(user.wallet_address),
        walletAddress: user.wallet_address,
        points: this.formatPoints(Number(user.delta_points)),
        reward: rewardMap.get(index + 1) || '',
      }));

      await this.setCache(CACHE_KEYS.leaderboard(id), result, CACHE_TTL.liveLeaderboard);
      return result;
    }

    // Upcoming competitions have no leaderboard
    return [];
  }

  async createCompetition(data: {
    name: string;
    description?: string;
    prizePool: string;
    rewardBreakdown?: string;
    status?: string;
    startDate: string;
    endDate: string;
  }, createdBy: string): Promise<any> {
    const competition = await Competition.create({
      name: data.name,
      description: data.description || null,
      prizePool: data.prizePool,
      rewardBreakdown: data.rewardBreakdown || null,
      status: (data.status as any) || 'upcoming',
      startDate: new Date(data.startDate),
      endDate: new Date(data.endDate),
      createdBy,
    });

    // Auto-snapshot if created directly as live
    if (competition.status === 'live') {
      await this.snapshotPoints(Number(competition.id));
    }

    await this.invalidateCache();
    return this.formatCompetition(competition);
  }

  async updateCompetition(id: number, data: {
    name?: string;
    description?: string;
    prizePool?: string;
    rewardBreakdown?: string;
    status?: string;
    startDate?: string;
    endDate?: string;
  }): Promise<any | null> {
    const competition = await Competition.findByPk(id);
    if (!competition) return null;

    const updateData: any = {};
    if (data.name !== undefined) updateData.name = data.name;
    if (data.description !== undefined) updateData.description = data.description;
    if (data.prizePool !== undefined) updateData.prizePool = data.prizePool;
    if (data.rewardBreakdown !== undefined) updateData.rewardBreakdown = data.rewardBreakdown;
    if (data.status !== undefined) updateData.status = data.status;
    if (data.startDate !== undefined) updateData.startDate = new Date(data.startDate);
    if (data.endDate !== undefined) updateData.endDate = new Date(data.endDate);

    await competition.update(updateData);

    // Auto-snapshot all users' points when competition goes live
    if (data.status === 'live') {
      await this.snapshotPoints(id);
    }

    await this.invalidateCache(id);
    return this.formatCompetition(competition);
  }

  async deleteCompetition(id: number): Promise<boolean> {
    const competition = await Competition.findByPk(id);
    if (!competition) return false;

    if (competition.status !== 'upcoming') {
      throw new Error('Only upcoming competitions can be deleted');
    }

    await competition.destroy(); // CASCADE deletes rewards
    await this.invalidateCache(id);
    return true;
  }

  async setRewards(competitionId: number, rewards: { rank: number; reward: string }[]): Promise<any[]> {
    const competition = await Competition.findByPk(competitionId);
    if (!competition) throw new Error('Competition not found');

    // Replace all rewards in a transaction
    await sequelize.transaction(async (t) => {
      await CompetitionReward.destroy({
        where: { competitionId },
        transaction: t,
      });

      if (rewards.length > 0) {
        await CompetitionReward.bulkCreate(
          rewards.map(r => ({
            competitionId,
            rank: r.rank,
            reward: r.reward,
          })),
          { transaction: t }
        );
      }
    });

    await this.invalidateCache(competitionId);

    return CompetitionReward.findAll({
      where: { competitionId },
      order: [['rank', 'ASC']],
      attributes: ['rank', 'reward'],
    });
  }

  async finalizeCompetition(id: number): Promise<any> {
    const competition = await Competition.findByPk(id);
    if (!competition) throw new Error('Competition not found');

    if (competition.status !== 'ended') {
      // Auto-set to ended if end date has passed
      if (new Date() < competition.endDate) {
        throw new Error('Competition has not ended yet');
      }
      await competition.update({ status: 'ended' });
    }

    // Get reward config to determine how many ranks to snapshot
    const rewards = await CompetitionReward.findAll({
      where: { competitionId: id },
      order: [['rank', 'ASC']],
    });

    const topN = Math.max(rewards.length, 20); // At least top 20
    const rewardMap = new Map(rewards.map(r => [r.rank, r.reward]));

    // Get delta leaderboard (competition-period points only)
    const deltaUsers: { wallet_address: string; delta_points: number }[] = await sequelize.query(
      `SELECT sp.wallet_address,
              (sp.total_points - COALESCE(snap.points_at_start, 0)) AS delta_points
       FROM space_points sp
       LEFT JOIN competition_point_snapshots snap
         ON snap.wallet_address = sp.wallet_address AND snap.competition_id = :competitionId
       WHERE (sp.total_points - COALESCE(snap.points_at_start, 0)) > 0
       ORDER BY delta_points DESC, sp.total_trades DESC
       LIMIT :limit`,
      {
        replacements: { competitionId: id, limit: topN },
        type: QueryTypes.SELECT,
      }
    );

    // Batch fetch usernames
    const walletAddresses = deltaUsers.map(u => u.wallet_address);
    const profiles = await UserProfile.findAll({
      where: { walletAddress: walletAddresses },
      attributes: ['walletAddress', 'twitterUsername'],
    });
    const profileMap = new Map(profiles.map(p => [p.walletAddress, p.twitterUsername]));

    // Store frozen leaderboard in a transaction
    await sequelize.transaction(async (t) => {
      // Clear any existing leaderboard entries for this competition
      await CompetitionLeaderboard.destroy({
        where: { competitionId: id },
        transaction: t,
      });

      await CompetitionLeaderboard.bulkCreate(
        deltaUsers.map((user, index) => ({
          competitionId: id,
          rank: index + 1,
          walletAddress: user.wallet_address,
          username: profileMap.get(user.wallet_address) || null,
          points: Number(user.delta_points),
          reward: rewardMap.get(index + 1) || null,
        })),
        { transaction: t }
      );
    });

    await this.invalidateCache(id);
    return { success: true, entriesStored: deltaUsers.length };
  }

  // Snapshot all users' current totalPoints for a competition
  async snapshotPoints(competitionId: number): Promise<void> {
    // Clear any existing snapshots for this competition (in case of re-trigger)
    await CompetitionPointSnapshot.destroy({ where: { competitionId } });

    // Insert snapshot for every user in space_points
    await sequelize.query(
      `INSERT INTO competition_point_snapshots (competition_id, wallet_address, points_at_start)
       SELECT :competitionId, wallet_address, total_points
       FROM space_points`,
      { replacements: { competitionId } }
    );
  }

  // --- Helpers ---

  private formatCompetition(c: Competition): any {
    return {
      id: Number(c.id),
      name: c.name,
      description: c.description,
      prizePool: c.prizePool,
      rewardBreakdown: c.rewardBreakdown,
      status: c.status,
      startDate: c.startDate,
      endDate: c.endDate,
      createdBy: c.createdBy,
      rewards: c.rewards?.map((r: any) => ({ rank: r.rank, reward: r.reward })) || [],
      createdAt: c.createdAt,
      updatedAt: c.updatedAt,
    };
  }

  private truncateWallet(wallet: string): string {
    if (wallet.length <= 8) return wallet;
    return `${wallet.slice(0, 4)}...${wallet.slice(-4)}`;
  }

  private formatPoints(points: number): string {
    return points.toLocaleString('en-US');
  }
}

export const competitionService = new CompetitionService();
