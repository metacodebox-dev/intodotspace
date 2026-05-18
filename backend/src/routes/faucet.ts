import { Router, Request, Response, NextFunction } from 'express';
import { faucetService } from '../services/faucetService';
import { authService } from '../services/authService';

const router = Router();

const authenticateRequest = (req: Request, res: Response, next: NextFunction) => {
  const authHeader = req.headers.authorization;

  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({
      error: { code: 'UNAUTHORIZED', message: 'No authentication token provided' },
    });
  }

  const token = authHeader.substring(7);
  const user = authService.getUserFromToken(token);

  if (!user || !authService.isSessionValid(token)) {
    return res.status(401).json({
      error: { code: 'INVALID_TOKEN', message: 'Invalid or expired token' },
    });
  }

  (req as any).walletAddress = user.walletAddress;
  next();
};

/**
 * GET /faucet/status
 * Check if user can claim and when next claim is available
 */
router.get('/status', authenticateRequest, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const walletAddress = (req as any).walletAddress;
    const status = await faucetService.getStatus(walletAddress);

    res.json({
      success: true,
      data: status,
    });
  } catch (error) {
    next(error);
  }
});

/**
 * POST /faucet/claim
 * Claim 500 USDC from the faucet (once per 24h)
 */
router.post('/claim', authenticateRequest, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const walletAddress = (req as any).walletAddress;
    const result = await faucetService.claim(walletAddress);

    if (!result.success) {
      return res.status(400).json({
        error: {
          code: 'FAUCET_CLAIM_FAILED',
          message: result.message,
          nextClaimAt: result.nextClaimAt,
        },
      });
    }

    res.json({
      success: true,
      data: {
        message: result.message,
        txSignature: result.txSignature,
        amount: result.amount,
      },
    });
  } catch (error) {
    next(error);
  }
});

/**
 * GET /faucet/sol/status
 * Check if user can claim SOL and when next claim is available
 */
router.get('/sol/status', authenticateRequest, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const walletAddress = (req as any).walletAddress;
    const status = await faucetService.getSolStatus(walletAddress);

    res.json({
      success: true,
      data: status,
    });
  } catch (error) {
    next(error);
  }
});

/**
 * POST /faucet/sol/claim
 * Claim 0.1 SOL from the faucet (once per 24h)
 */
router.post('/sol/claim', authenticateRequest, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const walletAddress = (req as any).walletAddress;
    const result = await faucetService.claimSol(walletAddress);

    if (!result.success) {
      return res.status(400).json({
        error: {
          code: 'SOL_FAUCET_CLAIM_FAILED',
          message: result.message,
          nextClaimAt: result.nextClaimAt,
        },
      });
    }

    res.json({
      success: true,
      data: {
        message: result.message,
        txSignature: result.txSignature,
        amount: result.amount,
      },
    });
  } catch (error) {
    next(error);
  }
});

/**
 * GET /faucet/space/status
 * Check if user can claim SPACE and when next claim is available
 */
router.get('/space/status', authenticateRequest, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const walletAddress = (req as any).walletAddress;
    const status = await faucetService.getSpaceStatus(walletAddress);

    res.json({
      success: true,
      data: status,
    });
  } catch (error) {
    next(error);
  }
});

/**
 * POST /faucet/space/claim
 * Claim 100 SPACE from the faucet (once per 24h)
 */
router.post('/space/claim', authenticateRequest, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const walletAddress = (req as any).walletAddress;
    const result = await faucetService.claimSpace(walletAddress);

    if (!result.success) {
      return res.status(400).json({
        error: {
          code: 'SPACE_FAUCET_CLAIM_FAILED',
          message: result.message,
          nextClaimAt: result.nextClaimAt,
        },
      });
    }

    res.json({
      success: true,
      data: {
        message: result.message,
        txSignature: result.txSignature,
        amount: result.amount,
      },
    });
  } catch (error) {
    next(error);
  }
});

export { router as faucetRoutes };
