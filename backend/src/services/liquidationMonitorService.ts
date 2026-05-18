import { EventEmitter } from 'events';
import { PositionService, PositionData } from './positionService';
import { OrderBookService } from './orderBookService';
import { Market } from '../models/Market';
import { wsEventEmitter } from '../websocket/server';

/**
 * Service to monitor positions for liquidation risk
 * Emits WebSocket events when positions become liquidatable
 */
export class LiquidationMonitorService extends EventEmitter {
  private positionService: PositionService;
  private orderBookService: OrderBookService;
  private monitoringInterval: NodeJS.Timeout | null = null;
  private monitoredPositions: Map<string, { lastChecked: Date; wasLiquidatable: boolean }> = new Map();

  constructor() {
    super();
    this.positionService = new PositionService();
    this.orderBookService = new OrderBookService();
  }

  /**
   * Start monitoring all positions for liquidation risk
   */
  startMonitoring(intervalMs: number = 5000) {
    if (this.monitoringInterval) {
      clearInterval(this.monitoringInterval);
    }

    this.monitoringInterval = setInterval(async () => {
      try {
        await this.checkAllPositions();
      } catch (error) {
        console.error('[LiquidationMonitor] Error checking positions:', error);
      }
    }, intervalMs);

    console.log(`[LiquidationMonitor] Started monitoring (interval: ${intervalMs}ms)`);
  }

  /**
   * Stop monitoring
   */
  stopMonitoring() {
    if (this.monitoringInterval) {
      clearInterval(this.monitoringInterval);
      this.monitoringInterval = null;
      console.log('[LiquidationMonitor] Stopped monitoring');
    }
  }

  /**
   * Check all positions for liquidation risk
   */
  private async checkAllPositions() {
    try {
      // Get all active markets
      const markets = await Market.findAll({
        where: { status: 0 }, // Active markets
      });

      // For each market, we need to check all positions
      // Since we don't have a direct way to get all positions, we'll need to
      // track positions that have been seen before and check them
      // In production, you might want to maintain a positions table or cache

      // For now, we'll emit events when positions are checked via the position service
      // The position service already calculates liquidation status
    } catch (error) {
      console.error('[LiquidationMonitor] Error in checkAllPositions:', error);
    }
  }

  /**
   * Check a specific user's positions for liquidation
   * Called when positions are fetched
   */
  async checkUserPositions(userId: string) {
    try {
      const positions = await this.positionService.getPositions(userId);

      for (const position of positions) {
        const positionKey = `${position.id}`;
        const wasLiquidatable = this.monitoredPositions.get(positionKey)?.wasLiquidatable || false;
        const isLiquidatable = position.isLiquidatable || false;

        // Update tracking
        this.monitoredPositions.set(positionKey, {
          lastChecked: new Date(),
          wasLiquidatable: isLiquidatable,
        });

        // Emit event if position just became liquidatable
        if (isLiquidatable && !wasLiquidatable) {
          this.emitLiquidationWarning(position);
        }
      }
    } catch (error) {
      console.error(`[LiquidationMonitor] Error checking positions for user ${userId}:`, error);
    }
  }

  /**
   * Emit liquidation warning event
   */
  private emitLiquidationWarning(position: PositionData) {
    if (!position.currentPrice || !position.liquidationPrice) {
      return;
    }

    const event = {
      marketId: position.marketId,
      outcomeId: position.outcomeId,
      userId: position.user,
      positionId: position.id,
      liquidationPrice: position.liquidationPrice,
      currentPrice: position.currentPrice,
      equity: position.equity || '0',
      timestamp: new Date().toISOString(),
    };

    // Emit to WebSocket server
    wsEventEmitter.emit('liquidation', event);

    // Also emit locally
    this.emit('liquidation_warning', event);

    console.log(`[LiquidationMonitor] Position ${position.id} is liquidatable!`);
    console.log(`  User: ${position.user.slice(0, 8)}...`);
    console.log(`  Market: ${position.marketId}`);
    console.log(`  Current Price: ${position.currentPrice}bps`);
    console.log(`  Liquidation Price: ${position.liquidationPrice}bps`);
    console.log(`  Equity: ${position.equity} USDC`);
  }
}



