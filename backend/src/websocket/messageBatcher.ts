/**
 * Message batching and compression for high-throughput scenarios
 * Reduces network overhead and improves performance
 */

interface BatchedMessage {
  type: string;
  channel: string;
  marketId?: string;
  outcomeId?: number;
  data: any;
  timestamp: string;
}

export class MessageBatcher {
  private batchQueue: Map<string, BatchedMessage[]> = new Map();
  private batchInterval: number = 50; // 50ms batching window
  private batchTimers: Map<string, NodeJS.Timeout> = new Map();
  private maxBatchSize: number = 100;

  /**
   * Add message to batch queue
   */
  addToBatch(
    channelKey: string,
    message: Omit<BatchedMessage, 'timestamp'>
  ): void {
    if (!this.batchQueue.has(channelKey)) {
      this.batchQueue.set(channelKey, []);
    }

    const queue = this.batchQueue.get(channelKey)!;
    queue.push({
      ...message,
      timestamp: new Date().toISOString(),
    });

    // If batch is full, flush immediately
    if (queue.length >= this.maxBatchSize) {
      this.flushBatch(channelKey);
      return;
    }

    // Set timer to flush batch
    if (!this.batchTimers.has(channelKey)) {
      const timer = setTimeout(() => {
        this.flushBatch(channelKey);
      }, this.batchInterval);
      this.batchTimers.set(channelKey, timer);
    }
  }

  /**
   * Flush batch for a channel
   */
  private flushBatch(channelKey: string): BatchedMessage[] | null {
    const queue = this.batchQueue.get(channelKey);
    if (!queue || queue.length === 0) {
      return null;
    }

    // Clear timer
    const timer = this.batchTimers.get(channelKey);
    if (timer) {
      clearTimeout(timer);
      this.batchTimers.delete(channelKey);
    }

    // Clear queue
    this.batchQueue.delete(channelKey);

    // Return batched messages (will be sent by caller)
    return queue;
  }

  /**
   * Get and flush batch for a channel
   */
  getAndFlushBatch(channelKey: string): BatchedMessage[] | null {
    return this.flushBatch(channelKey);
  }

  /**
   * Flush all batches
   */
  flushAll(): Map<string, BatchedMessage[]> {
    const allBatches = new Map(this.batchQueue);
    
    // Clear all timers
    for (const timer of this.batchTimers.values()) {
      clearTimeout(timer);
    }
    this.batchTimers.clear();
    this.batchQueue.clear();

    return allBatches;
  }
}

// Singleton instance
export const messageBatcher = new MessageBatcher();

