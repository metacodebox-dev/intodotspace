import { Router } from 'express';
import { TokenService } from '../services/tokenService';

const router = Router();
const tokenService = new TokenService();

router.get('/space/info', async (req, res, next) => {
  try {
    const info = await tokenService.getSpaceTokenInfo();
    res.json({ info });
  } catch (error) {
    next(error);
  }
});

router.get('/space/flywheel', async (req, res, next) => {
  try {
    const flywheel = await tokenService.getFlywheelStats();
    res.json({ flywheel });
  } catch (error) {
    next(error);
  }
});

export { router as tokenRoutes };







