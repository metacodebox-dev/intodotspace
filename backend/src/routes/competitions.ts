import { Router } from 'express';
import { z } from 'zod';
import { requireAuth } from '../middleware/authMiddleware';
import { requireAdmin } from '../middleware/adminMiddleware';
import { competitionService } from '../services/competitionService';

const router = Router();

// --- Validation Schemas ---

const createCompetitionSchema = z.object({
  name: z.string().min(1).max(255),
  description: z.string().optional(),
  prizePool: z.string().min(1).max(100),
  rewardBreakdown: z.string().max(255).optional(),
  status: z.enum(['upcoming', 'live', 'ended']).optional(),
  startDate: z.string().min(1),
  endDate: z.string().min(1),
});

const updateCompetitionSchema = z.object({
  name: z.string().min(1).max(255).optional(),
  description: z.string().optional(),
  prizePool: z.string().min(1).max(100).optional(),
  rewardBreakdown: z.string().max(255).optional(),
  status: z.enum(['upcoming', 'live', 'ended']).optional(),
  startDate: z.string().optional(),
  endDate: z.string().optional(),
});

const setRewardsSchema = z.object({
  rewards: z.array(z.object({
    rank: z.number().int().positive(),
    reward: z.string().min(1).max(255),
  })).min(0),
});

// --- Public Endpoints ---

// GET / - List all competitions
router.get('/', async (req, res, next) => {
  try {
    const competitions = await competitionService.listCompetitions();
    res.json({ success: true, data: competitions });
  } catch (error) {
    next(error);
  }
});

// GET /:id - Single competition
router.get('/:id', async (req, res, next) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (isNaN(id)) {
      return res.status(400).json({ error: { code: 'INVALID_ID', message: 'Invalid competition ID' } });
    }

    const competition = await competitionService.getCompetition(id);
    if (!competition) {
      return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Competition not found' } });
    }

    res.json({ success: true, data: competition });
  } catch (error) {
    next(error);
  }
});

// GET /:id/leaderboard - Leaderboard for a competition
router.get('/:id/leaderboard', async (req, res, next) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (isNaN(id)) {
      return res.status(400).json({ error: { code: 'INVALID_ID', message: 'Invalid competition ID' } });
    }

    const limit = Math.min(parseInt(req.query.limit as string, 10) || 50, 100);
    const leaderboard = await competitionService.getCompetitionLeaderboard(id, limit);
    res.json({ success: true, data: leaderboard });
  } catch (error) {
    next(error);
  }
});

// --- Admin Endpoints ---

// POST / - Create competition
router.post('/', requireAuth, requireAdmin, async (req, res, next) => {
  try {
    const data = createCompetitionSchema.parse(req.body);
    const competition = await competitionService.createCompetition(data, req.user!.walletAddress);
    res.status(201).json({ success: true, data: competition });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({
        error: { code: 'VALIDATION_ERROR', message: 'Invalid input', details: error.errors },
      });
    }
    next(error);
  }
});

// PUT /:id - Update competition
router.put('/:id', requireAuth, requireAdmin, async (req, res, next) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (isNaN(id)) {
      return res.status(400).json({ error: { code: 'INVALID_ID', message: 'Invalid competition ID' } });
    }

    const data = updateCompetitionSchema.parse(req.body);
    const competition = await competitionService.updateCompetition(id, data);
    if (!competition) {
      return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Competition not found' } });
    }

    res.json({ success: true, data: competition });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({
        error: { code: 'VALIDATION_ERROR', message: 'Invalid input', details: error.errors },
      });
    }
    next(error);
  }
});

// DELETE /:id - Delete competition (upcoming only)
router.delete('/:id', requireAuth, requireAdmin, async (req, res, next) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (isNaN(id)) {
      return res.status(400).json({ error: { code: 'INVALID_ID', message: 'Invalid competition ID' } });
    }

    const deleted = await competitionService.deleteCompetition(id);
    if (!deleted) {
      return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Competition not found' } });
    }

    res.json({ success: true, message: 'Competition deleted' });
  } catch (error: any) {
    if (error.message === 'Only upcoming competitions can be deleted') {
      return res.status(400).json({ error: { code: 'INVALID_STATUS', message: error.message } });
    }
    next(error);
  }
});

// PUT /:id/rewards - Set reward tiers
router.put('/:id/rewards', requireAuth, requireAdmin, async (req, res, next) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (isNaN(id)) {
      return res.status(400).json({ error: { code: 'INVALID_ID', message: 'Invalid competition ID' } });
    }

    const { rewards } = setRewardsSchema.parse(req.body);
    const result = await competitionService.setRewards(id, rewards);
    res.json({ success: true, data: result });
  } catch (error: any) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({
        error: { code: 'VALIDATION_ERROR', message: 'Invalid input', details: error.errors },
      });
    }
    if (error.message === 'Competition not found') {
      return res.status(404).json({ error: { code: 'NOT_FOUND', message: error.message } });
    }
    next(error);
  }
});

// POST /:id/finalize - Finalize ended competition
router.post('/:id/finalize', requireAuth, requireAdmin, async (req, res, next) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (isNaN(id)) {
      return res.status(400).json({ error: { code: 'INVALID_ID', message: 'Invalid competition ID' } });
    }

    const result = await competitionService.finalizeCompetition(id);
    res.json({ success: true, data: result });
  } catch (error: any) {
    if (error.message === 'Competition not found' || error.message === 'Competition has not ended yet') {
      return res.status(400).json({ error: { code: 'INVALID_STATE', message: error.message } });
    }
    next(error);
  }
});

export { router as competitionRoutes };
