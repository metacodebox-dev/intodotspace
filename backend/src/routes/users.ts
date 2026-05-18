import { Router } from 'express';
import { UserService } from '../services/userService';

const router = Router();
const userService = new UserService();

// GET /api/v1/users/:userId/stats
// Get user statistics including volume and PnL
router.get('/:userId/stats', async (req, res, next) => {
  try {
    const stats = await userService.getUserStats(req.params.userId);
    res.json({ stats });
  } catch (error) {
    next(error);
  }
});

// GET /api/v1/users/:userId/volume-pnl
// Get user volume and PnL metrics (simplified endpoint for profile page)
router.get('/:userId/volume-pnl', async (req, res, next) => {
  try {
    const [totalVolume, allTimePnL] = await Promise.all([
      userService.calculateTotalVolume(req.params.userId),
      userService.calculateAllTimePnL(req.params.userId),
    ]);
    
    res.json({
      totalVolume,
      allTimePnL,
    });
  } catch (error) {
    console.error(`[Users API] Error getting volume/PnL for user ${req.params.userId}:`, error);
    next(error);
  }
});

// GET /api/v1/users/:userId/lifetime-rewards
// Get user lifetime rewards (simplified endpoint for profile page)
router.get('/:userId/lifetime-rewards', async (req, res, next) => {
  try {
    const lifetimeRewards = await userService.calculateLifetimeRewards(req.params.userId);
    
    res.json({
      lifetimeRewards,
    });
  } catch (error) {
    console.error(`[Users API] Error getting lifetime rewards for user ${req.params.userId}:`, error);
    next(error);
  }
});

router.get('/:userId/rewards', async (req, res, next) => {
  try {
    const rewards = await userService.getUserRewards(req.params.userId);
    res.json({ rewards });
  } catch (error) {
    next(error);
  }
});

router.get('/:userId/portfolio', async (req, res, next) => {
  try {
    const portfolio = await userService.getPortfolio(req.params.userId);
    res.json({ portfolio });
  } catch (error) {
    next(error);
  }
});

export { router as userRoutes };







