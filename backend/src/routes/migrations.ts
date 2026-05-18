import { Router } from 'express';
import { z } from 'zod';
import { PublicKey } from '@solana/web3.js';
import { requireAuth } from '../middleware/authMiddleware';
import { requireAdmin } from '../middleware/adminMiddleware';
import { autoMarketKeeperService } from '../services/autoMarketKeeperService';

const router = Router();

const migrateSchema = z.object({
  marketPubkey: z.string().min(32).max(44),
  quoteMint: z.string().min(32).max(44).optional(),
});

// GET /v1-markets — lists markets still on the pre-v2 layout
router.get('/v1-markets', requireAuth, requireAdmin, async (_req, res, next) => {
  try {
    if (!autoMarketKeeperService.isReady) {
      const ok = await autoMarketKeeperService.initialize();
      if (!ok) {
        return res.status(503).json({
          error: {
            code: 'KEEPER_UNAVAILABLE',
            message: 'Auto keeper not initialized (missing AUTO_MARKET_KEEPER_KEYPAIR?)',
          },
        });
      }
    }
    const markets = await autoMarketKeeperService.listV1Markets();
    res.json({ success: true, data: markets });
  } catch (error) {
    next(error);
  }
});

// POST /migrate — migrates a single market. Body: { marketPubkey, quoteMint? }
router.post('/migrate', requireAuth, requireAdmin, async (req, res, next) => {
  try {
    const { marketPubkey, quoteMint } = migrateSchema.parse(req.body);

    if (!autoMarketKeeperService.isReady) {
      const ok = await autoMarketKeeperService.initialize();
      if (!ok) {
        return res.status(503).json({
          error: { code: 'KEEPER_UNAVAILABLE', message: 'Auto keeper not initialized' },
        });
      }
    }

    let marketKey: PublicKey;
    try {
      marketKey = new PublicKey(marketPubkey);
    } catch {
      return res
        .status(400)
        .json({ error: { code: 'INVALID_PUBKEY', message: 'marketPubkey is not a valid Solana address' } });
    }

    const quoteMintKey = quoteMint ? new PublicKey(quoteMint) : undefined;
    const signature = await autoMarketKeeperService.migrateMarketToV2(marketKey, quoteMintKey);
    res.json({ success: true, data: { signature, marketPubkey } });
  } catch (error: any) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({
        error: { code: 'VALIDATION_ERROR', message: 'Invalid input', details: error.errors },
      });
    }
    const msg = String(error?.message || error);
    if (msg.includes('AlreadyMigrated') || msg.includes('already migrated')) {
      return res
        .status(409)
        .json({ error: { code: 'ALREADY_MIGRATED', message: 'Market is already at v2' } });
    }
    if (msg.includes('Unauthorized')) {
      return res.status(403).json({
        error: {
          code: 'MIGRATION_UNAUTHORIZED',
          message:
            'Keeper is not this market\'s creator and not config.admin. Migrate via CLI using the creator\'s keypair.',
        },
      });
    }
    next(error);
  }
});

export { router as migrationRoutes };
