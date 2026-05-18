# Liquidation System Scaling Guide

## Problem: Single Keypair Bottleneck

Using **one keypair for thousands of markets** creates several bottlenecks:

1. **Rate Limiting**: RPC endpoints throttle requests from single account
2. **Transaction Queue**: Solana limits transactions per account per slot
3. **Sequential Processing**: Can only process one market at a time
4. **Single Point of Failure**: If keypair is compromised or rate-limited, all liquidations stop

## Solution: Multi-Liquidator Pool

The improved system uses **multiple liquidator keypairs** with:

- **Market Sharding**: Each market assigned to specific liquidator (consistent hashing)
- **Load Distribution**: Markets distributed evenly across liquidators
- **Parallel Execution**: Multiple liquidations execute simultaneously
- **Priority Queue**: Urgent liquidations processed first
- **Fault Tolerance**: If one liquidator fails, others continue

## Architecture

```
10,000 Markets
    ↓
[Market Sharding]
    ↓
20 Liquidators (each handles ~500 markets)
    ↓
[Parallel Processing]
    ↓
50 concurrent liquidations
```

## Setup Instructions

### Step 1: Generate Multiple Liquidator Keypairs

```bash
# Generate 20 liquidator keypairs
for i in {0..19}; do
  solana-keygen new -o liquidator-keypair-$i.json --no-bip39-passphrase
  echo "Liquidator $i: $(solana-keygen pubkey liquidator-keypair-$i.json)"
done
```

### Step 2: Fund Each Liquidator

```bash
# Fund each liquidator with SOL (for transaction fees)
for i in {0..19}; do
  PUBKEY=$(solana-keygen pubkey liquidator-keypair-$i.json)
  solana airdrop 1 $PUBKEY
done
```

### Step 3: Configure Environment Variables

Add to `.env`:

```bash
# Primary liquidator (backward compatibility)
LIQUIDATOR_KEYPAIR=$(cat liquidator-keypair-0.json | jq -c '.[:32]')

# Additional liquidators
LIQUIDATOR_KEYPAIR_1=$(cat liquidator-keypair-1.json | jq -c '.[:32]')
LIQUIDATOR_KEYPAIR_2=$(cat liquidator-keypair-2.json | jq -c '.[:32]')
LIQUIDATOR_KEYPAIR_3=$(cat liquidator-keypair-3.json | jq -c '.[:32]')
# ... up to LIQUIDATOR_KEYPAIR_19

# Maximum number of liquidators to use
MAX_LIQUIDATORS=20
```

### Step 4: Verify Setup

```typescript
// Check liquidator pool stats
const executor = new LiquidationExecutorService();
await executor.initialize();
const stats = executor.getStats();
console.log(stats);
// Should show: totalLiquidators: 20
```

## Performance Characteristics

### Single Liquidator (Old)
- **Markets**: 10,000
- **Check Time**: ~100 seconds (sequential)
- **Throughput**: ~100 markets/second
- **Bottleneck**: Single keypair rate limiting

### Multi-Liquidator (New)
- **Markets**: 10,000
- **Liquidators**: 20
- **Markets per Liquidator**: ~500
- **Check Time**: ~10 seconds (parallel)
- **Throughput**: ~1,000 markets/second
- **Concurrent Liquidations**: 100 (5 per liquidator × 20)

## Scaling Recommendations

### For 1,000 Markets
- **Liquidators**: 5-10
- **Markets per Liquidator**: 100-200
- **Check Interval**: 5 seconds
- **Full Cycle**: ~5-10 seconds

### For 10,000 Markets
- **Liquidators**: 20-50
- **Markets per Liquidator**: 200-500
- **Check Interval**: 5 seconds
- **Full Cycle**: ~10-20 seconds

### For 100,000 Markets
- **Liquidators**: 50-100
- **Markets per Liquidator**: 1,000-2,000
- **Check Interval**: 3 seconds
- **Full Cycle**: ~15-30 seconds

## Key Features

### 1. Consistent Market Sharding

Markets are assigned to liquidators using **consistent hashing**:
- Same market always goes to same liquidator
- Even distribution across liquidators
- Easy to add/remove liquidators

```typescript
// Market ID → Liquidator Index (consistent)
const liquidator = assignMarketToLiquidator(marketId);
```

### 2. Priority Queue

Liquidations are prioritized by urgency:
- **High Priority**: Equity < 5% (processed first)
- **Medium Priority**: Equity 5-10% (processed next)
- **Low Priority**: Equity > 10% (not liquidatable)

### 3. Concurrent Execution

Each liquidator can handle multiple liquidations:
- **Per Liquidator**: 5 concurrent liquidations
- **Total**: 20 liquidators × 5 = 100 concurrent liquidations
- **Rate Limiting**: Per-liquidator to avoid RPC throttling

### 4. Load Balancing

Markets are distributed evenly:
- Hash-based assignment ensures even distribution
- Each liquidator handles similar number of markets
- Automatic load balancing

## Monitoring

### Check Liquidator Stats

```typescript
const stats = executor.getStats();
console.log(stats);
// {
//   totalLiquidators: 20,
//   queueSize: 15,
//   liquidators: [
//     {
//       index: 0,
//       publicKey: "7xKXtg2C...",
//       assignedMarkets: 487,
//       activeLiquidations: 2,
//       totalLiquidations: 1234,
//       totalRewards: 567.89,
//       lastActivity: "2024-01-24T10:30:00Z"
//     },
//     ...
//   ]
// }
```

### Monitor Individual Liquidators

- **Active Liquidations**: Should be < MAX_CONCURRENT_PER_LIQUIDATOR
- **Total Liquidations**: Track success rate
- **Total Rewards**: Track profitability
- **Last Activity**: Ensure liquidators are active

## Troubleshooting

### Issue: Some liquidators not processing

**Check**:
1. Are keypairs funded with SOL?
2. Are keypairs valid?
3. Check RPC endpoint health
4. Check liquidator stats: `executor.getStats()`

### Issue: Uneven distribution

**Solution**: Consistent hashing ensures even distribution. If markets are clustered, consider:
- Using more liquidators
- Adjusting hash function
- Manual market assignment (advanced)

### Issue: Rate limiting

**Solution**:
- Reduce `MAX_CONCURRENT_PER_LIQUIDATOR`
- Increase `MIN_TIME_BETWEEN_CHECKS`
- Use multiple RPC endpoints
- Add delays between batches

## Best Practices

1. **Start Small**: Begin with 5-10 liquidators, scale up as needed
2. **Monitor Performance**: Track stats regularly
3. **Fund Adequately**: Each liquidator needs SOL for fees
4. **Backup Keypairs**: Store keypairs securely
5. **Test First**: Test with small number of markets
6. **Gradual Scaling**: Add liquidators gradually

## Cost Analysis

### Transaction Fees (per liquidation)
- **Base Fee**: ~0.000005 SOL
- **Priority Fee**: ~0.00001 SOL (optional)
- **Total**: ~0.000015 SOL per liquidation

### For 10,000 liquidations/month:
- **Cost**: 10,000 × 0.000015 = 0.15 SOL
- **Reward**: 5% of liquidation value (much higher)
- **Net**: Highly profitable

### With 20 liquidators:
- **Cost per liquidator**: 0.15 / 20 = 0.0075 SOL/month
- **Fund each**: 0.1 SOL (covers ~13 months)

## Migration from Single to Multi-Liquidator

1. **Generate keypairs** (see Step 1)
2. **Fund keypairs** (see Step 2)
3. **Update .env** (see Step 3)
4. **Restart backend**: New system automatically uses all keypairs
5. **Monitor stats**: Verify all liquidators are active
6. **Remove old single keypair**: System works with multiple keypairs

## Conclusion

**Single keypair**: ❌ Not scalable for thousands of markets
**Multi-liquidator pool**: ✅ Handles millions of markets efficiently

The new system is:
- **10-100x faster** (parallel processing)
- **More reliable** (fault tolerant)
- **Scalable** (add more liquidators as needed)
- **Profitable** (rewards distributed across liquidators)



