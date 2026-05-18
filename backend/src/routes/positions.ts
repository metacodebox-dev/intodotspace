import { Router } from 'express';
import { PositionService } from '../services/positionService';

const router = Router();
const positionService = new PositionService();

// GET /api/v1/positions?user=<pubkey>
// Get all positions for a user with PnL and liquidation price
router.get('/', async (req, res, next) => {
  try {
    const { user } = req.query;
    
    if (!user) {
      return res.status(400).json({ error: 'User pubkey is required' });
    }

    const positions = await positionService.getPositions(user as string);
    res.json({ positions });
  } catch (error) {
    next(error);
  }
});

// GET /api/v1/positions/user/:pubkey
// Alternative endpoint for user positions
router.get('/user/:pubkey', async (req, res, next) => {
  try {
    const pubkey = req.params.pubkey;
    console.log(`[Positions API] Fetching positions for user: ${pubkey}`);
    const positions = await positionService.getPositions(pubkey);
    console.log(`[Positions API] Returning ${positions.length} positions`);
    res.json({ positions });
  } catch (error) {
    console.error('[Positions API] Error:', error);
    next(error);
  }
});

// GET /api/v1/positions/user/:pubkey/resolved
// Positions on finalized markets, including ones already claimed
// (isOpen=false, shares=0). Powers the "Resolved" portfolio tab so users
// can see their full win/loss history.
router.get('/user/:pubkey/resolved', async (req, res, next) => {
  try {
    const positions = await positionService.getResolvedPositions(req.params.pubkey);
    res.json({ positions });
  } catch (error) {
    console.error('[Positions API] Resolved error:', error);
    next(error);
  }
});

// POST /api/v1/positions/record-redemption
// Records a successful redemption so the resolved-positions tab can show
// the historical payout AFTER `shares` has been zeroed by the redeem flow.
// Called by the frontend immediately after a successful redeem_shares tx.
//
// Body: { user, marketAddress, outcomeId, tokenType, sharesRedeemed, txSignature? }
//
// `tokenType` ('yes'|'no') tells us which mint was burned for the user on
// this outcome. We update every Position row matching (user, market,
// outcome, tokenType) — there can be more than one (spot/leveraged
// variants of the same logical position).
router.post('/record-redemption', async (req, res, next) => {
  try {
    const { Position } = await import('../models/Position');
    const { user, marketAddress, outcomeId, tokenType, sharesRedeemed } = req.body || {};

    if (!user || !marketAddress || outcomeId === undefined || !tokenType || !sharesRedeemed) {
      return res.status(400).json({
        error: 'Missing required fields: user, marketAddress, outcomeId, tokenType, sharesRedeemed',
      });
    }
    if (tokenType !== 'yes' && tokenType !== 'no') {
      return res.status(400).json({ error: 'tokenType must be "yes" or "no"' });
    }

    // Persist as a string (lamport count). BigInt arrives over JSON as
    // either number or string; coerce defensively.
    const sharesStr = String(sharesRedeemed);

    const [updated] = await Position.update(
      {
        redeemedShares: sharesStr,
        // Also flip these so the resolved-tab winner display kicks in even
        // if the keeper hasn't synced yet.
        shares: '0',
        isOpen: false,
        lastUpdated: new Date(),
      },
      {
        where: {
          user,
          marketAddress,
          outcomeId: parseInt(outcomeId, 10),
          tokenType,
        },
      },
    );

    res.json({ success: true, positionsUpdated: updated });
  } catch (error) {
    console.error('[Positions API] Record-redemption error:', error);
    next(error);
  }
});

// POST /api/v1/positions/cleanup
// Cleanup closed positions (mark positions with 0 shares as closed)
// Optional query param: ?user=<pubkey> to cleanup only for specific user
router.post('/cleanup', async (req, res, next) => {
  try {
    const { user } = req.query;
    const userPubkey = user as string | undefined;
    
    const { cleanupClosedPositions } = await import('../scripts/cleanupClosedPositions');
    
    // Run cleanup (this will update the database)
    await cleanupClosedPositions(userPubkey);
    
    res.json({ 
      success: true, 
      message: userPubkey 
        ? `Cleaned up closed positions for user ${userPubkey}` 
        : 'Cleaned up all closed positions'
    });
  } catch (error) {
    console.error('[Positions API] Cleanup error:', error);
    next(error);
  }
});

router.get('/:positionId', async (req, res, next) => {
  try {
    const position = await positionService.getPositionById(req.params.positionId);
    if (!position) {
      return res.status(404).json({ error: 'Position not found' });
    }
    res.json({ position });
  } catch (error) {
    next(error);
  }
});

// POST /api/v1/positions/sync/:positionId
// Force sync a position from on-chain to database
router.post('/sync/:positionId', async (req, res, next) => {
  try {
    const positionId = req.params.positionId;
    const { user, marketAddress, outcomeId, side, positionType } = req.body;
    
    if (!user || !marketAddress || outcomeId === undefined || side === undefined || positionType === undefined) {
      return res.status(400).json({ 
        error: 'Missing required fields: user, marketAddress, outcomeId, side, positionType' 
      });
    }
    
    // Use the positionService to sync the position
    // This will check on-chain and update the database
    await positionService.syncPositionFromChain(
      positionId,
      marketAddress,
      user,
      outcomeId,
      side,
      positionType
    );
    
    res.json({ 
      success: true, 
      message: `Position ${positionId} synced successfully` 
    });
  } catch (error) {
    console.error('[Positions API] Sync error:', error);
    next(error);
  }
});

export { router as positionRoutes };



