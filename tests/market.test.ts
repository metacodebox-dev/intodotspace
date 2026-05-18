import { describe, it, expect } from '@jest/globals';
import { Market, MarketCategory, MarketStatus } from '@space/shared';
import BN from 'bn.js';

describe('Market Types', () => {
  it('should create a valid market', () => {
    const market: Market = {
      id: 'test-market-1',
      publicKey: {} as any,
      creator: {} as any,
      title: 'Will Bitcoin reach $100k?',
      description: 'Test market description',
      category: MarketCategory.CRYPTO,
      outcomes: [
        {
          id: 'yes',
          label: 'Yes',
          sharePrice: new BN(5000), // 50%
          totalShares: new BN(1000),
          liquidity: new BN(500000000), // 500 USDC
        },
        {
          id: 'no',
          label: 'No',
          sharePrice: new BN(5000), // 50%
          totalShares: new BN(1000),
          liquidity: new BN(500000000), // 500 USDC
        },
      ],
      status: MarketStatus.ACTIVE,
      resolutionSource: null,
      resolutionData: null,
      resolvedOutcome: null,
      endDate: new Date('2024-12-31'),
      createdAt: new Date(),
      totalVolume: new BN(0),
      totalLiquidity: new BN(1000000000), // 1000 USDC
    };

    expect(market.title).toBe('Will Bitcoin reach $100k?');
    expect(market.outcomes.length).toBe(2);
    expect(market.status).toBe(MarketStatus.ACTIVE);
  });
});






