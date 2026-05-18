import { getRedisClient } from '../config/redis';
import { MarketService } from './marketService';

const CACHE_TTL = 30; // seconds — list view, brief staleness is acceptable
const CACHE_PREFIX = 'markets:list:';

interface ListFilters {
  category?: string;
  status?: string;
  search?: string;
  quoteSymbol?: string;
  limit: number;
  offset: number;
}

export class MarketsListCache {
  private redis: ReturnType<typeof getRedisClient>;
  private service: MarketService;

  constructor() {
    this.redis = getRedisClient();
    this.service = new MarketService();
  }

  private buildKey(filters: ListFilters): string {
    // Normalize: trim, lowercase, replace separators in search so the key stays parseable
    const norm = (v: string | undefined) => (v ?? '').trim().toLowerCase().replace(/[|:]/g, '_');
    return [
      CACHE_PREFIX,
      norm(filters.category),
      norm(filters.status),
      norm(filters.quoteSymbol),
      norm(filters.search),
      filters.offset,
      filters.limit,
    ].join('|');
  }

  async getMarkets(filters: ListFilters) {
    const key = this.buildKey(filters);

    try {
      const cached = await this.redis.get(key);
      if (cached) {
        return JSON.parse(cached);
      }
    } catch (err) {
      console.error('[MarketsListCache] Redis get error:', err);
    }

    const result = await this.service.getMarkets(filters);

    try {
      await this.redis.setex(key, CACHE_TTL, JSON.stringify(result));
    } catch (err) {
      console.error('[MarketsListCache] Redis set error:', err);
    }

    return result;
  }

  async invalidateAll(): Promise<void> {
    try {
      const keys = await this.redis.keys(`${CACHE_PREFIX}*`);
      if (keys.length > 0) {
        await this.redis.del(...keys);
      }
    } catch (err) {
      console.error('[MarketsListCache] Redis invalidate error:', err);
    }
  }
}

export const marketsListCache = new MarketsListCache();
