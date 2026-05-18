import { Connection, PublicKey } from '@solana/web3.js';
import { UserStats, UserRewards, Portfolio } from '@space/shared';
import { Order, Position, Market } from '../models';
import { PositionService } from './positionService';
import { Op } from 'sequelize';

export class UserService {
  private connection: Connection;
  private positionService: PositionService;

  constructor() {
    this.connection = new Connection(
      process.env.SOLANA_RPC_URL || 'http://localhost:8899',
      {
        commitment: 'confirmed',
        wsEndpoint: process.env.SOLANA_WS_URL,
        confirmTransactionInitialTimeout: 60000,
      }
    );
    this.positionService = new PositionService();
  }

  /**
   * Calculate total volume for a user (sum of all filled buy + sell orders in USDC)
   */
  async calculateTotalVolume(userId: string): Promise<number> {
    try {
      // Get all filled orders for the user (both buy and sell)
      const filledOrders = await Order.findAll({
        where: {
          userId,
          status: {
            [Op.in]: ['filled', 'partially_filled'],
          },
        },
      });

      // Sum up the filled amounts (in lamports, convert to USDC)
      let totalVolumeLamports = BigInt(0);
      for (const order of filledOrders) {
        const filled = order.getFilledBigInt();
        totalVolumeLamports += filled;
      }

      // Convert from lamports to USDC (1 USDC = 1e6 lamports)
      return Number(totalVolumeLamports) / 1e6;
    } catch (error) {
      console.error(`[UserService] Error calculating total volume for user ${userId}:`, error);
      return 0;
    }
  }

  /**
   * Calculate all-time PnL for a user (sum of PnL from all open + closed positions)
   * For open positions: uses positionService to get accurate unrealized PnL with current prices
   * For closed positions: uses stored realizedPnl field
   */
  async calculateAllTimePnL(userId: string): Promise<number> {
    try {
      let totalPnL = 0;

      // Get all open positions with accurate PnL calculation (includes current prices)
      const openPositions = await this.positionService.getPositions(userId);
      
      // Sum unrealized PnL from open positions
      for (const pos of openPositions) {
        if (pos.pnl) {
          totalPnL += parseFloat(pos.pnl);
        }
      }

      // Get all closed positions and sum their realized PnL
      const closedPositions = await Position.findAll({
        where: {
          user: userId,
          [Op.or]: [
            { isOpen: false },
            { shares: '0' },
          ],
        },
      });

      // Sum realized PnL from closed positions
      for (const pos of closedPositions) {
        if (pos.realizedPnl) {
          totalPnL += parseFloat(pos.realizedPnl);
        }
      }

      return totalPnL;
    } catch (error) {
      console.error(`[UserService] Error calculating all-time PnL for user ${userId}:`, error);
      return 0;
    }
  }

  /**
   * Get user statistics including volume and PnL
   */
  async getUserStats(userId: string): Promise<UserStats> {
    try {
      const [totalVolume, allTimePnL] = await Promise.all([
        this.calculateTotalVolume(userId),
        this.calculateAllTimePnL(userId),
      ]);

      return {
        totalVolume,
        allTimePnL,
        // Add other stats as needed
      } as UserStats;
    } catch (error) {
      console.error(`[UserService] Error getting user stats for ${userId}:`, error);
      throw error;
    }
  }

  /**
   * Calculate lifetime rewards for a user
   * For now, returns 0 as there's no rewards payout system implemented yet
   * TODO: Implement actual rewards calculation when rewards system is added
   */
  async calculateLifetimeRewards(userId: string): Promise<number> {
    try {
      // TODO: Implement actual rewards calculation
      // This could include:
      // - Referral rewards (USDC earned from referrals)
      // - Trading rewards (USDC earned from trading)
      // - Liquidity rewards (USDC earned from providing liquidity)
      // - Airdrop rewards (USDC from airdrops)
      
      // For now, return 0 as no rewards system is implemented
      return 0;
    } catch (error) {
      console.error(`[UserService] Error calculating lifetime rewards for user ${userId}:`, error);
      return 0;
    }
  }

  async getUserRewards(userId: string): Promise<UserRewards> {
    // Implementation would fetch user rewards
    throw new Error('Not implemented');
  }

  async getPortfolio(userId: string): Promise<Portfolio> {
    // Implementation would fetch portfolio
    throw new Error('Not implemented');
  }
}







