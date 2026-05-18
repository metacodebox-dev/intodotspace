# Liquidation System Testing Guide

## Overview

The liquidation system automatically liquidates undercollateralized leveraged positions to protect the protocol and liquidity providers.

## Liquidation Parameters

- **Maintenance Margin**: 10% (1000 basis points)
  - Position is liquidatable when: `equity < 10% of position_value`
  
- **Liquidation Step**: 25% (2500 basis points)
  - Each liquidation liquidates 25% of the position
  - Multiple liquidations may be needed to fully liquidate a position
  
- **Liquidation Penalty**: 10% (1000 basis points)
  - 5% goes to liquidator (reward)
  - 5% goes to insurance fund

## How Liquidations Work

### Step 1: Position Monitoring
The `LiquidationExecutorService` continuously monitors all leveraged positions (leverage > 1).

### Step 2: Liquidation Check
For each position, the system checks:
```
equity = collateral + PnL
maintenance_requirement = position_value * 10%
is_liquidatable = equity < maintenance_requirement
```

### Step 3: Execution
When a position is liquidatable:
1. Liquidate 25% of position shares
2. Transfer 5% of liquidation value to liquidator
3. Transfer 5% of liquidation value to insurance fund
4. Update position (reduce shares and collateral)
5. Repeat if position is still liquidatable

## Testing Steps

### Prerequisites

1. **Set up liquidator keypair**:
   ```bash
   # Generate a new keypair for liquidations
   solana-keygen new -o liquidator-keypair.json
   
   # Fund it with SOL for transaction fees
   solana airdrop 1 <LIQUIDATOR_PUBKEY>
   
   # Add to .env
   LIQUIDATOR_KEYPAIR=$(cat liquidator-keypair.json | jq -c '.[:32]')
   ```

2. **Fund liquidator USDC account** (optional, for receiving rewards):
   ```bash
   # The liquidator will receive 5% of liquidation value as reward
   # USDC ATA will be created automatically if needed
   ```

### Manual Testing

#### Test 1: Create a Liquidatable Position

1. **Open a leveraged position**:
   - Market: Any active market
   - Side: Long or Short
   - Leverage: 5x or higher (higher leverage = easier to liquidate)
   - Collateral: Small amount (e.g., 10 USDC)
   - Shares: Large amount (e.g., 1000 shares)

2. **Wait for price to move against position**:
   - For LONG: Price needs to drop significantly
   - For SHORT: Price needs to rise significantly
   - Monitor position equity in frontend

3. **Verify liquidation status**:
   ```typescript
   // In backend, check position status
   const status = await liquidationExecutor.checkPositionLiquidationStatus(
     marketPDA,
     positionPDA
   );
   console.log(status);
   // Should show: isLiquidatable: true
   ```

#### Test 2: Execute Liquidation Manually

```typescript
// In backend console or script
import { LiquidationExecutorService } from './services/liquidationExecutorService';
import { PublicKey } from '@solana/web3.js';

const executor = new LiquidationExecutorService();
await executor.initialize();

const result = await executor.executeLiquidation(
  new PublicKey('MARKET_PDA'),
  new PublicKey('POSITION_PDA'),
  'USER_ID' // optional
);

console.log(result);
// Should show: { success: true, tx: '...' }
```

#### Test 3: Verify Liquidation Results

1. **Check position on-chain**:
   ```bash
   # Position shares should be reduced by 25%
   # Position collateral should be reduced proportionally
   anchor account Position <POSITION_PDA>
   ```

2. **Check liquidator reward**:
   ```bash
   # Liquidator USDC balance should increase
   # Reward = 5% of liquidation value
   spl-token balance <LIQUIDATOR_USDC_ATA>
   ```

3. **Check insurance fund**:
   ```bash
   # Insurance fund should receive 5% of liquidation value
   anchor account InsuranceFund
   ```

#### Test 4: Partial Liquidation Flow

1. **Create a large liquidatable position**
2. **Execute first liquidation** (liquidates 25%)
3. **Check if position is still liquidatable**
4. **Execute second liquidation** (liquidates another 25%)
5. **Repeat until position is fully liquidated or equity restored**

### Automated Testing

The `LiquidationExecutorService` can run automatically:

```typescript
// In backend/src/index.ts
const liquidationExecutor = new LiquidationExecutorService();
await liquidationExecutor.initialize();
liquidationExecutor.startMonitoring(5000); // Check every 5 seconds
```

**Note**: For automated liquidations to work, you need to:
1. **Track positions in database**: When positions are created, store them in a `positions` table
2. **Query positions**: The service queries the database for all leveraged positions
3. **Check liquidation status**: For each position, check if it's liquidatable
4. **Execute liquidations**: Automatically liquidate liquidatable positions

## Position Tracking Implementation

To enable automated liquidations at scale, implement position tracking:

### Database Schema

```sql
CREATE TABLE positions (
  id VARCHAR(255) PRIMARY KEY, -- Position PDA
  market_id VARCHAR(255) NOT NULL,
  user_id VARCHAR(255) NOT NULL,
  outcome_id INT NOT NULL,
  side INT NOT NULL, -- 0 = long, 1 = short
  leverage INT NOT NULL,
  shares BIGINT NOT NULL,
  collateral BIGINT NOT NULL,
  avg_entry_price INT NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  last_checked TIMESTAMP,
  is_liquidatable BOOLEAN DEFAULT FALSE,
  INDEX idx_market_leverage (market_id, leverage),
  INDEX idx_liquidatable (is_liquidatable, last_checked)
);
```

### Track Positions When Created

```typescript
// In your position creation endpoint
async function createLeveragedPosition(...) {
  // ... create position on-chain ...
  
  // Track in database
  await Position.create({
    id: positionPDA.toString(),
    market_id: marketId,
    user_id: userId,
    outcome_id: outcomeId,
    side: side,
    leverage: leverage,
    shares: shares.toString(),
    collateral: collateral.toString(),
    avg_entry_price: entryPrice,
  });
}
```

### Query Liquidatable Positions

```typescript
// In LiquidationExecutorService.checkMarketPositions()
const liquidatablePositions = await Position.findAll({
  where: {
    marketId: market.id,
    leverage: { [Op.gt]: 1 }, // Only leveraged positions
    isLiquidatable: true, // Or check on-chain
  },
  order: [['last_checked', 'ASC']], // Check oldest first
  limit: 100, // Batch size
});
```

## Optimization for Scale (Millions of Users)

### 1. Efficient Position Discovery

**Problem**: Enumerating all positions on-chain is slow and expensive.

**Solution**: 
- Track positions in database when created
- Use indexed queries for fast lookups
- Cache frequently checked positions

### 2. Batch Processing

**Problem**: Checking millions of positions sequentially is too slow.

**Solution**:
- Process positions in batches (e.g., 100 at a time)
- Use parallel processing (e.g., 10 concurrent batches)
- Prioritize positions by liquidation risk

### 3. Smart Scheduling

**Problem**: Checking all positions every 5 seconds is wasteful.

**Solution**:
- Check high-risk positions more frequently (every 1 second)
- Check low-risk positions less frequently (every 30 seconds)
- Skip positions that were recently checked and are healthy

### 4. Rate Limiting

**Problem**: Too many RPC calls can get throttled.

**Solution**:
- Limit concurrent liquidations (e.g., max 10 at a time)
- Add delays between batches
- Use multiple RPC endpoints with load balancing

### 5. Caching

**Problem**: Repeatedly fetching market prices is expensive.

**Solution**:
- Cache market prices (update every 1-2 seconds)
- Cache position data (update on state changes)
- Use Redis for distributed caching

## Monitoring & Alerts

### Key Metrics to Monitor

1. **Liquidation Rate**: Number of liquidations per hour
2. **Liquidation Value**: Total value liquidated
3. **Liquidator Rewards**: Total rewards paid
4. **Insurance Fund Growth**: Total penalties collected
5. **Failed Liquidations**: Liquidations that failed (should be 0)

### Alerts

- High liquidation rate (indicates market volatility)
- Failed liquidations (indicates system issues)
- Low insurance fund balance (indicates risk)

## Troubleshooting

### Issue: Liquidations not executing

**Check**:
1. Is `LIQUIDATOR_KEYPAIR` set in environment?
2. Is liquidator keypair funded with SOL?
3. Are positions being tracked in database?
4. Are positions actually liquidatable (check on-chain)?

### Issue: "Position not liquidatable" error

**Reason**: Position equity >= maintenance requirement
- Price may have moved in favor of position
- Position may have been partially liquidated already
- Check position status on-chain

### Issue: Transaction failures

**Check**:
1. RPC endpoint health
2. Network congestion
3. Transaction fees (may need priority fees)
4. Account rent requirements

## Best Practices

1. **Always verify on-chain before liquidating**: Don't trust database state alone
2. **Handle partial liquidations**: Position may need multiple liquidations
3. **Monitor gas costs**: Ensure liquidator has enough SOL
4. **Set up alerts**: Monitor liquidation system health
5. **Test thoroughly**: Test with small positions first
6. **Document positions**: Track all positions in database for efficient queries



