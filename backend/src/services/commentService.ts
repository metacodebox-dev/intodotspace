import { Comment, CommentStar, CommentReport } from '../models/Comment';
import { UserProfile } from '../models/UserProfile';
import { sequelize } from '../config/database';
import { referralService } from './referralService';

export interface CommentResponse {
  id: number;
  marketId: number;
  walletAddress: string;
  username: string | null;
  avatar: string | null;
  text: string;
  stars: number;
  starredByUser: boolean;
  createdAt: Date;
}

class CommentService {
  async getComments(
    marketId: number,
    requestingWallet: string | null,
    limit: number = 50,
    offset: number = 0
  ): Promise<{ comments: CommentResponse[]; total: number }> {
    const { rows, count } = await Comment.findAndCountAll({
      where: { marketId, status: 'active' },
      order: [['createdAt', 'DESC']],
      limit,
      offset,
    });

    if (rows.length === 0) {
      return { comments: [], total: 0 };
    }

    // Batch fetch profiles
    const wallets = [...new Set(rows.map(r => r.walletAddress))];
    const profiles = await UserProfile.findAll({
      where: { walletAddress: wallets },
      attributes: ['walletAddress', 'twitterUsername', 'twitterAvatarUrl'],
    });
    const profileMap = new Map(
      profiles.map(p => [p.walletAddress, { username: p.twitterUsername, avatar: p.twitterAvatarUrl }])
    );

    // Batch fetch user's stars
    let starredSet = new Set<number>();
    if (requestingWallet) {
      const commentIds = rows.map(r => r.id);
      const stars = await CommentStar.findAll({
        where: { commentId: commentIds, walletAddress: requestingWallet },
        attributes: ['commentId'],
      });
      starredSet = new Set(stars.map(s => s.commentId));
    }

    const comments: CommentResponse[] = rows.map(row => {
      const profile = profileMap.get(row.walletAddress);
      return {
        id: row.id,
        marketId: row.marketId,
        walletAddress: row.walletAddress,
        username: profile?.username || null,
        avatar: profile?.avatar || null,
        text: row.text,
        stars: row.stars,
        starredByUser: starredSet.has(row.id),
        createdAt: row.createdAt,
      };
    });

    return { comments, total: count };
  }

  async createComment(marketId: number, walletAddress: string, text: string): Promise<CommentResponse> {
    const comment = await Comment.create({ marketId, walletAddress, text });

    // Award comment points (max 3/day, non-blocking)
    try {
      await referralService.addCommentPoints(walletAddress);
    } catch (err) {
      // Non-critical - don't fail comment creation
    }

    const profile = await UserProfile.findOne({
      where: { walletAddress },
      attributes: ['twitterUsername', 'twitterAvatarUrl'],
    });

    return {
      id: comment.id,
      marketId: comment.marketId,
      walletAddress: comment.walletAddress,
      username: profile?.twitterUsername || null,
      avatar: profile?.twitterAvatarUrl || null,
      text: comment.text,
      stars: 0,
      starredByUser: false,
      createdAt: comment.createdAt,
    };
  }

  async deleteComment(commentId: number, walletAddress: string): Promise<boolean> {
    const result = await Comment.destroy({
      where: { id: commentId, walletAddress },
    });
    return result > 0;
  }

  async starComment(commentId: number, walletAddress: string): Promise<{ success: boolean; stars: number }> {
    const comment = await Comment.findByPk(commentId);
    if (!comment || comment.status !== 'active') {
      return { success: false, stars: 0 };
    }

    try {
      await sequelize.transaction(async (transaction) => {
        await CommentStar.create({ commentId, walletAddress }, { transaction });
        await Comment.increment('stars', { by: 1, where: { id: commentId }, transaction });
      });

      const updated = await Comment.findByPk(commentId, { attributes: ['stars'] });
      return { success: true, stars: updated?.stars || comment.stars + 1 };
    } catch (error: any) {
      // Unique constraint violation = already starred
      if (error.name === 'SequelizeUniqueConstraintError') {
        return { success: false, stars: comment.stars };
      }
      throw error;
    }
  }

  async reportComment(commentId: number, walletAddress: string): Promise<{ success: boolean; deleted: boolean }> {
    const comment = await Comment.findByPk(commentId);
    if (!comment || comment.status !== 'active') {
      return { success: false, deleted: false };
    }

    try {
      let newCount = comment.reportCount;

      await sequelize.transaction(async (transaction) => {
        await CommentReport.create({ commentId, walletAddress }, { transaction });
        await Comment.increment('reportCount', { by: 1, where: { id: commentId }, transaction });
        newCount = comment.reportCount + 1;
      });

      // Auto-delete when report count reaches 20
      if (newCount >= 20) {
        await Comment.update(
          { status: 'removed' },
          { where: { id: commentId } }
        );
        return { success: true, deleted: true };
      }

      return { success: true, deleted: false };
    } catch (error: any) {
      // Unique constraint = already reported by this user
      if (error.name === 'SequelizeUniqueConstraintError') {
        return { success: false, deleted: false };
      }
      throw error;
    }
  }
}

export const commentService = new CommentService();
