// Load environment variables FIRST before any other imports
import dotenv from 'dotenv';
dotenv.config();

import express from 'express';
import cors from 'cors';
import { createServer } from 'http';
import { marketRoutes } from './routes/markets';
import { orderRoutes } from './routes/orders';
import { orderBookRoutes } from './routes/orderbook';
import { positionRoutes } from './routes/positions';
import { userRoutes } from './routes/users';
import { tokenRoutes } from './routes/tokens';
import { xRoutes } from './routes/x';
import { authRoutes } from './routes/auth';
import { referralRoutes } from './routes/referrals';
import { commentRoutes } from './routes/comments';
import { notificationRoutes } from './routes/notifications';
import { faucetRoutes } from './routes/faucet';
import { competitionRoutes } from './routes/competitions';
import { autoMarketRoutes } from './routes/autoMarket';
import { migrationRoutes } from './routes/migrations';
import { betaGateRoutes, getBetaGateConfig } from './betaGate';
import cookieParser from 'cookie-parser';
import { errorHandler } from './middleware/errorHandler';
import { middleware as loggerMiddleware } from './utils/logger';
import { connectDatabase } from './config/database';
import { runMigrations } from './utils/migrations';
import { OrderMatchingService } from './services/orderMatchingService';
import { LiquidationMonitorService } from './services/liquidationMonitorService';
import { LiquidationExecutorService } from './services/liquidationExecutorService';
import { setupWebSocket } from './websocket/server';
import { getRedisClient } from './config/redis';
import { connectionManager } from './websocket/connectionManager';

const app = express();
const server = createServer(app);
const PORT = process.env.PORT || 3001;

const allowedOrigins = [
  'http://localhost:3000',
  'https://prediction-frontend-lilac.vercel.app',
  process.env.FRONTEND_URL,
].filter(Boolean);

app.use(cors({
  origin(origin, callback) {
    if (!origin) return callback(null, true);

    const normalizedOrigin = origin.replace(/\/$/, '');

    if (allowedOrigins.includes(normalizedOrigin)) {
      return callback(null, true);
    }

    console.warn('[CORS BLOCKED]', origin);
    return callback(new Error('Not allowed by CORS'));
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS', 'PATCH'],
  allowedHeaders: [
    'Content-Type',
    'Authorization',
    'X-Requested-With',
    'x-pubkey', 
  ],
}));


app.use(express.json());
app.use(cookieParser());
app.use(loggerMiddleware);

// Health check with metrics
app.get('/health', async (req, res) => {
  try {
    const metrics = connectionManager.getMetrics();
    const redis = getRedisClient();
    const betaConfig = getBetaGateConfig();
    
    // Check Redis connectivity
    let redisStatus = 'disconnected';
    try {
      await redis.ping();
      redisStatus = 'connected';
    } catch (error) {
      redisStatus = 'error';
    }
    
    res.json({
      status: 'ok',
      timestamp: new Date().toISOString(),
      connections: metrics.totalConnections,
      subscriptions: metrics.activeSubscriptions,
      redis: redisStatus,
      database: 'connected', // Already checked on startup
      betaGate: betaConfig.enabled ? 'enabled' : 'disabled',
    });
  } catch (error) {
    res.status(500).json({
      status: 'error',
      timestamp: new Date().toISOString(),
      error: 'Health check failed',
    });
  }
});

// Routes - Support both /api and /api/v1 for backward compatibility
app.use('/api/auth', authRoutes);
app.use('/api/v1/auth', authRoutes);
app.use('/api/markets', marketRoutes);
app.use('/api/v1/markets', marketRoutes);
app.use('/api/orders', orderRoutes);
app.use('/api/v1/orders', orderRoutes);
app.use('/api/orderbook', orderBookRoutes);
app.use('/api/v1/orderbook', orderBookRoutes);
app.use('/api/positions', positionRoutes);
app.use('/api/v1/positions', positionRoutes);
app.use('/api/users', userRoutes);
app.use('/api/v1/users', userRoutes);
app.use('/api/tokens', tokenRoutes);
app.use('/api/v1/tokens', tokenRoutes);
app.use('/api/x', xRoutes);
app.use('/api/v1/x', xRoutes);
app.use('/api/referrals', referralRoutes);
app.use('/api/v1/referrals', referralRoutes);
app.use('/api/comments', commentRoutes);
app.use('/api/v1/comments', commentRoutes);
app.use('/api/notifications', notificationRoutes);
app.use('/api/v1/notifications', notificationRoutes);
app.use('/api/faucet', faucetRoutes);
app.use('/api/v1/faucet', faucetRoutes);

// Competition routes
app.use('/api/competitions', competitionRoutes);
app.use('/api/v1/competitions', competitionRoutes);

// Auto-market routes (price feeds, admin controls)
app.use('/api/auto-market', autoMarketRoutes);
app.use('/api/v1/auto-market', autoMarketRoutes);

// Market v1 -> v2 migration (admin only)
app.use('/api/admin/migrations', migrationRoutes);
app.use('/api/v1/admin/migrations', migrationRoutes);

// Beta Gate routes (wrapper module - does not depend on existing auth)
app.use('/api/beta', betaGateRoutes);
app.use('/api/v1/beta', betaGateRoutes);

// Error handler
app.use(errorHandler);

// Initialize database and start server
async function startServer() {
  try {
    await connectDatabase();

    // Run database migrations
    await runMigrations();

    // Initialize model associations
    const { initializeModels, FaucetClaim } = await import('./models');
    initializeModels();

    // Sync FaucetClaim table (migration SQL files aren't included in TS build)
    await FaucetClaim.sync();
    
    // Initialize Redis (for production scaling)
    try {
      const redis = getRedisClient();
      const pingResult = await redis.ping();
      console.log('[Server] Redis connected successfully');
      console.log('[Server] Redis ping:', pingResult);
      
      // Test Redis operations
      await redis.set('ws:test', 'connected', 'EX', 10);
      const testValue = await redis.get('ws:test');
      if (testValue === 'connected') {
        console.log('[Server] Redis read/write test passed');
      }
    } catch (redisError: any) {
      console.error('[Server] Redis connection failed:', redisError.message);
      console.warn('[Server] WebSocket will run in single-server mode');
      console.warn('[Server] Multi-server scaling requires Redis');
      // Don't exit - server can still run without Redis for single-server deployments
    }
    
    // Setup WebSocket server
    setupWebSocket(server);
    
    // Cleanup stale connections every 5 minutes
    setInterval(async () => {
      await connectionManager.cleanupStaleConnections();
    }, 5 * 60 * 1000);
    
    // Start periodic order matching and keeper service
    const orderMatchingService = new OrderMatchingService();
    // WS events trigger matching on-demand; periodic tick is fallback only.
    orderMatchingService.startPeriodicMatching(30000); // Match every 30s (was 10s)

    try {
      orderMatchingService.startKeeper(30000); // Execute every 30s (was 10s)
    } catch (error) { /* Logs disabled */ }

    // Start liquidation monitoring — slowed to 60s since the findAll is mostly no-op
    const liquidationMonitor = new LiquidationMonitorService();
    liquidationMonitor.startMonitoring(60000); // was 5000

    // Start liquidation executor (automatic liquidations) — slowed to 30s
    try {
      const liquidationExecutor = new LiquidationExecutorService();
      const executorInitialized = await liquidationExecutor.initialize();
      if (executorInitialized) {
        liquidationExecutor.startMonitoring(30000); // was 5000
        console.log('[Server] Liquidation executor started');
      } else {
        console.warn('[Server] Liquidation executor not initialized - set LIQUIDATOR_KEYPAIR in .env');
      }
    } catch (error) {
      console.error('[Server] Failed to start liquidation executor:', error);
    }

    // Start auto-market services (Binance price feed + scheduler + resolver)
    try {
      const { binancePriceService } = await import('./services/binancePriceService');
      const { autoMarketKeeperService } = await import('./services/autoMarketKeeperService');
      const { autoMarketSchedulerService } = await import('./services/autoMarketSchedulerService');
      const { autoResolverService } = await import('./services/autoResolverService');

      binancePriceService.start();

      const keeperReady = await autoMarketKeeperService.initialize();
      if (keeperReady) {
        // Wait 5s for Binance prices to warm up before starting scheduler
        setTimeout(() => {
          if (process.env.AUTO_MARKET_ENABLED === 'true') {
            autoMarketSchedulerService.start();
            autoResolverService.start();
            console.log('[Server] Auto-market scheduler + resolver started');
          } else {
            console.log('[Server] Auto-market scheduler disabled (set AUTO_MARKET_ENABLED=true to enable)');
          }
        }, 5000);
      } else {
        console.warn('[Server] Auto-market keeper not initialized — set AUTO_MARKET_KEEPER_KEYPAIR in .env');
      }
    } catch (error) {
      console.error('[Server] Failed to start auto-market services:', error);
    }
    
    server.listen(PORT, () => {
      const protocol = process.env.NODE_ENV === 'production' ? 'wss' : 'ws';
      const host = process.env.RENDER_EXTERNAL_HOSTNAME || 
                    process.env.HOST || 
                    'localhost';
      const wsUrl = process.env.NODE_ENV === 'production' 
        ? `wss://${host}/ws`
        : `ws://localhost:${PORT}/ws`;
      
      console.log(`[Server] HTTP server listening on port ${PORT}`);
      console.log(`[Server] WebSocket server available at ${wsUrl}`);
      console.log(`[Server] Environment: ${process.env.NODE_ENV || 'development'}`);
      console.log(`[Server] FRONTEND_URL: ${process.env.FRONTEND_URL || 'not set'}`);
    });
  } catch (error) {
    console.error('Failed to start server:', error);
    process.exit(1);
  }
}

startServer();

