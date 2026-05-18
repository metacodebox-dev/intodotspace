import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { notificationService } from '../services/notificationService';
import { logger } from '../utils/logger';

const router = Router();

// Small in-memory cache — 1s TTL. Absorbs burst requests from multiple tabs
// without degrading UX. DB query is already fast; this just kills duplicate load.
const unreadCountCache = new Map<string, { count: number; expires: number }>();
const UNREAD_COUNT_TTL_MS = 1000;

/**
 * GET /api/notifications
 * Get user notifications with pagination and filters
 */
router.get('/', async (req: Request, res: Response) => {
  try {
    // Get userId from query param or header (depending on your auth setup)
    const userId = req.query.userId as string || req.headers['x-user-id'] as string || req.headers['x-pubkey'] as string;

    if (!userId) {
      return res.status(401).json({
        error: 'UNAUTHORIZED',
        message: 'User ID required',
      });
    }

    const limit = parseInt(req.query.limit as string) || 50;
    const offset = parseInt(req.query.offset as string) || 0;
    const unreadOnly = req.query.unreadOnly === 'true';
    const type = req.query.type as string | undefined;

    const result = await notificationService.getUserNotifications({
      userId,
      limit: Math.min(limit, 100), // Cap at 100
      offset,
      unreadOnly,
      type: type as any,
    });

    // Get unread count
    const unreadCount = await notificationService.getUnreadCount(userId);

    return res.json({
      notifications: result.notifications.map((n) => {
        // Ensure dates are always in ISO string format (UTC)
        let createdAt: string;
        if (n.createdAt instanceof Date) {
          createdAt = n.createdAt.toISOString();
        } else if (typeof n.createdAt === 'string') {
          // If it's already a string, ensure it's a valid ISO string
          const date = new Date(n.createdAt);
          createdAt = isNaN(date.getTime()) ? new Date().toISOString() : date.toISOString();
        } else {
          createdAt = new Date().toISOString();
        }
        
        let readAt: string | undefined;
        if (n.readAt) {
          if (n.readAt instanceof Date) {
            readAt = n.readAt.toISOString();
          } else if (typeof n.readAt === 'string') {
            const date = new Date(n.readAt);
            readAt = isNaN(date.getTime()) ? undefined : date.toISOString();
          }
        }
        
        return {
          id: n.id,
          type: n.type,
          title: n.title,
          message: n.message,
          data: n.data,
          priority: n.priority,
          read: n.read,
          readAt,
          createdAt,
        };
      }),
      pagination: {
        total: result.total,
        limit,
        offset,
        hasMore: offset + limit < result.total,
      },
      unreadCount,
    });
  } catch (error: any) {
    logger.error('[Notifications] Error fetching notifications:', error);
    return res.status(500).json({
      error: 'INTERNAL_ERROR',
      message: 'Failed to fetch notifications',
    });
  }
});

/**
 * GET /api/notifications/unread-count
 * Get unread notification count
 */
router.get('/unread-count', async (req: Request, res: Response) => {
  try {
    const userId = req.query.userId as string || req.headers['x-user-id'] as string || req.headers['x-pubkey'] as string;

    if (!userId) {
      return res.status(401).json({
        error: 'UNAUTHORIZED',
        message: 'User ID required',
      });
    }

    // Serve from cache if fresh
    const cached = unreadCountCache.get(userId);
    if (cached && cached.expires > Date.now()) {
      return res.json({ count: cached.count, cached: true });
    }

    const count = await notificationService.getUnreadCount(userId);
    unreadCountCache.set(userId, { count, expires: Date.now() + UNREAD_COUNT_TTL_MS });

    // Opportunistic cleanup — bound the map size
    if (unreadCountCache.size > 1000) {
      const now = Date.now();
      for (const [k, v] of unreadCountCache) {
        if (v.expires <= now) unreadCountCache.delete(k);
      }
    }

    return res.json({ count });
  } catch (error: any) {
    logger.error('[Notifications] Error fetching unread count:', error);
    // Serve stale on error if we have anything cached
    const stale = unreadCountCache.get(
      (req.query.userId as string) || ''
    );
    if (stale) {
      return res.json({ count: stale.count, stale: true });
    }
    return res.status(500).json({
      error: 'INTERNAL_ERROR',
      message: 'Failed to fetch unread count',
    });
  }
});

/**
 * PATCH /api/notifications/:id/read
 * Mark a notification as read
 */
router.patch('/:id/read', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const userId = req.body.userId || req.headers['x-user-id'] as string || req.headers['x-pubkey'] as string;

    if (!userId) {
      return res.status(401).json({
        error: 'UNAUTHORIZED',
        message: 'User ID required',
      });
    }

    const notification = await notificationService.markAsRead(id, userId);

    return res.json({
      id: notification.id,
      read: notification.read,
      readAt: notification.readAt,
    });
  } catch (error: any) {
    if (error.message === 'Notification not found') {
      return res.status(404).json({
        error: 'NOT_FOUND',
        message: 'Notification not found',
      });
    }

    logger.error('[Notifications] Error marking notification as read:', error);
    return res.status(500).json({
      error: 'INTERNAL_ERROR',
      message: 'Failed to mark notification as read',
    });
  }
});

/**
 * PATCH /api/notifications/read-all
 * Mark all notifications as read for a user
 */
router.patch('/read-all', async (req: Request, res: Response) => {
  try {
    const userId = req.body.userId || req.headers['x-user-id'] as string || req.headers['x-pubkey'] as string;

    if (!userId) {
      return res.status(401).json({
        error: 'UNAUTHORIZED',
        message: 'User ID required',
      });
    }

    const count = await notificationService.markAllAsRead(userId);

    return res.json({
      count,
      message: `Marked ${count} notifications as read`,
    });
  } catch (error: any) {
    logger.error('[Notifications] Error marking all as read:', error);
    return res.status(500).json({
      error: 'INTERNAL_ERROR',
      message: 'Failed to mark all notifications as read',
    });
  }
});

/**
 * DELETE /api/notifications/:id
 * Delete a notification
 */
router.delete('/:id', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const userId = req.body.userId || req.headers['x-user-id'] as string || req.headers['x-pubkey'] as string;

    if (!userId) {
      return res.status(401).json({
        error: 'UNAUTHORIZED',
        message: 'User ID required',
      });
    }

    const deleted = await notificationService.deleteNotification(id, userId);

    if (!deleted) {
      return res.status(404).json({
        error: 'NOT_FOUND',
        message: 'Notification not found',
      });
    }

    return res.json({
      success: true,
      message: 'Notification deleted',
    });
  } catch (error: any) {
    logger.error('[Notifications] Error deleting notification:', error);
    return res.status(500).json({
      error: 'INTERNAL_ERROR',
      message: 'Failed to delete notification',
    });
  }
});

export const notificationRoutes = router;

