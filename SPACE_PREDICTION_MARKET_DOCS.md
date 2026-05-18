# Space Prediction Market - Complete Documentation

## Table of Contents
1. [Market Initialization](#market-initialization)
2. [Liquidity & Funding](#liquidity--funding)
3. [Order Book Mechanics](#order-book-mechanics)
4. [Starting Markets with Custom Prices (70-30)](#starting-markets-with-custom-prices-70-30)
5. [Order Types & Execution](#order-types--execution)
6. [Leverage Trading](#leverage-trading)
7. [Position Management](#position-management)
8. [Price Discovery & Updates](#price-discovery--updates)
9. [Market Resolution](#market-resolution)

---

## Market Initialization

### Overview
Every market starts with an initial collateral deposit from the market creator. This creates the foundational liquidity pool.

### Initialization Parameters

```typescript
initializeMarket({
  marketId: u64,                    // Unique market identifier
  title: string,                    // Market title
  description: string,              // Market description
  category: u8,                     // Market category (0-255)
  endDate: i64,                     // Unix timestamp for market end
  outcomeLabels: Vec<String>,       // Array of outcome labels (2-10 outcomes)
  initialCollateral: u64,           // USDC amount in lamports (minimum 5 USDC)
  resolutionType: u8                // 0=TWAP, 1=Oracle, 2=Manual
})
```

### Minimum Requirements

- **Minimum Initial Collateral**: 5 USDC (5,000,000 lamports)
- **Minimum Outcomes**: 2 (e.g., YES/NO)
- **Maximum Outcomes**: 10 (for multi-outcome markets)

### What Happens on Initialization

1. **Market Account Created**: PDA derived from `[b"market", creator, market_id]`
2. **NO Mint Created**: Single NO mint shared across all outcomes
3. **YES Mints Created**: One YES mint per outcome (e.g., YES_0, YES_1)
4. **Market Vault Created**: Holds all USDC collateral
5. **Initial Collateral Deposited**: Creator's USDC transferred to market vault
6. **Initial Prices Set**: All outcomes start at 5,000 bps (50%)

**Important**: Initial prices are always 50% regardless of collateral amount. To achieve 70-30 pricing, you must bootstrap liquidity (see section 4).

---

## Liquidity & Funding

### Where Funds Are Held

#### 1. Market Vault (Primary Liquidity Pool)
- **PDA**: `[b"vault", market]`
- **Authority**: `[b"vault_authority", market]`
- **Holds**: All USDC collateral from:
  - Initial market creation
  - Order margin deposits
  - Share minting operations
- **Used For**: 
  - Position payouts on close
  - Share redemption (burn)
  - Liquidation penalties

#### 2. Order Escrow Accounts
- **PDA**: `[b"order_escrow", user, order_id]`
- **Authority**: `[b"order_escrow_authority", user, order_id]`
- **Holds**: Margin for individual orders
- **Released**: On order execution, cancellation, or expiration

#### 3. Insurance Fund
- **PDA**: `[b"insurance_fund"]`
- **Vault**: `[b"insurance_vault"]`
- **Holds**: Liquidation penalties and protocol reserves
- **Used For**: Covering bad debt from liquidations

### Liquidity Requirements

#### For Market Creator
- **Minimum**: 5 USDC (5,000,000 lamports)
- **Recommended for Binary Market**: 100-500 USDC for initial liquidity
- **Recommended for Multi-Outcome**: 200-1000 USDC per outcome

#### For Liquidity Providers (Minters)
- **No minimum**: Can mint shares in any amount
- **1:1 Ratio**: 1 USDC → 1 YES share + 1 NO share
- **Always profitable at 50% price**: Can immediately burn for 1 USDC back

#### For Traders
- **Depends on leverage**: 
  - 1x leverage: 100% margin = full notional
  - 10x leverage: 10% margin = 1/10th notional
- **Minimum per order**: ~0.01 USDC (depends on price and quantity)

---

## Order Book Mechanics

### How the Order Book Works

This protocol uses a **Central Limit Order Book (CLOB)** pattern:

1. **Limit Orders**: Resting orders waiting for matches
   - Buy orders wait until a matching sell order appears
   - Sell orders wait until a matching buy order appears
   - Orders are matched when prices overlap

2. **Market Orders**: Immediate execution at best available price
   - Buy market order: Takes best available sell order
   - Sell market order: Takes best available buy order
   - Subject to slippage protection (`maxSlippageBps`)

3. **No Automated Market Maker**: 
   - Prices are determined purely by order matching
   - No constant product formula (like Uniswap)
   - Prices reflect supply/demand from orders only

### Price Discovery Flow

```
User Places Limit Order (e.g., Buy at 60%)
         ↓
Order Stored in PendingOrder Account
         ↓
Keeper Service Finds Matching Orders
         ↓
Step 1: validateMatch()
   - Validates both orders
   - Creates MatchState PDA
   - Sets buy_is_maker and sell_is_maker flags
   - Calculates fill_quantity and trade_value
   - Initializes: executed=false, buy_executed=false, sell_executed=false
         ↓
Step 2: executeBuyerMatch()
   - Checks: !executed && !buy_executed
   - Mints YES shares to buyer
   - Transfers USDC from buyer escrow to market vault
   - Applies buyer fees (0% if maker, dynamic if taker)
   - Updates buyer position
   - Sets: buy_executed = true
         ↓
Step 3: executeSellerMatch()
   - Checks: !executed && buy_executed && !sell_executed
   - Mints NO shares to seller
   - Applies seller fees (0% if maker, dynamic if taker)
   - Updates seller position
   - Calls add_price_snapshot() → Updates market.outcomes[].lastPrice
   - Sets: sell_executed = true, executed = true
         ↓
Price Updated: market.outcomes[outcome_id].lastPrice = match_price
Price Snapshot Added: For TWAP calculation
```

### Order Matching Logic

Orders match when:
- Buy order price >= Sell order price
- Same outcome ID
- Both orders are Open/PartiallyFilled
- Orders not expired (max 24 hours = MAX_ORDER_AGE_SECONDS)
- Both orders have sufficient margin
- Market status is Active
- Protocol is not paused

**Match Price**: 
- Must be between sell_order.price and buy_order.price (inclusive)
- Typically: `match_price = (buy_order.price + sell_order.price) / 2` (keeper's choice)
- Validated in `validate_match()`: `sell_order.price <= match_price <= buy_order.price`

**Maker vs Taker Determination**:
- Maker: Order that was placed first (earlier `created_at`) OR limit order
- Taker: Order that was placed later AND is a market order
- Makers pay 0% fees, Takers pay dynamic fees

---

## Starting Markets with Custom Prices (70-30)

### The Challenge

By default, all markets start at 50% (5,000 basis points). To achieve 70-30 pricing, you need to **bootstrap liquidity** by creating an initial price imbalance.

### Method 1: Share Minting + Burning (Recommended)

**Step 1: Creator Mints Shares**
```
Creator deposits 100 USDC → Gets 100 YES + 100 NO
```

**Step 2: Creator Sells YES Shares**
```
Creator places sell limit order for YES at 70% (7,000 bps)
- Sells 70 YES shares
- Receives: 70 * 0.70 = 49 USDC
- Still holds: 30 YES + 100 NO
```

**Step 3: First Buyer Matches**
```
Trader places buy order at 70%
- Buys 70 YES at 70%
- Pays: 70 * 0.70 = 49 USDC
- Market price updates to 70% for YES
```

**Result**: YES at 70%, NO at 30% (since YES + NO = 100%)

**Example Code**:
```typescript
// 1. Creator initializes market
await program.methods.initializeMarket(
  marketId,
  title,
  description,
  category,
  endDate,
  ['YES', 'NO'],
  usdcToLamports(100), // Initial collateral
  resolutionType
).rpc();

// 2. Creator mints shares
await program.methods.mintShares(
  0, // outcomeId for YES
  usdcToLamports(100) // Amount
).accounts({
  market: marketPDA,
  user: creator,
  // ... other accounts
}).rpc();

// 3. Creator places sell order at 70%
await program.methods.placeLimitOrder(
  orderId,
  0, // outcomeId (YES)
  1, // side (sell)
  7000, // price (70% = 7000 bps)
  usdcToLamports(70), // quantity
  1 // leverage
).rpc();

// 4. Bootstrap buy order (can be small)
await program.methods.placeMarketOrder(
  bootstrapOrderId,
  0, // outcomeId
  0, // side (buy)
  usdcToLamports(1), // small quantity to trigger match
  100, // maxSlippage (1%)
  1 // leverage
).rpc();
```

### Method 2: Direct Limit Orders

If you have willing participants:

1. **Creator places large sell order at 70%**
   - This becomes the order book
   - Price discovery happens when buyers match

2. **Early buyers place buy orders at 70%**
   - Matches immediately
   - Market price updates to 70%

### Method 3: Incentivized Bootstrap

1. **Creator deposits initial collateral**
2. **Creator offers bonus to first traders** (off-chain)
3. **First traders place orders at desired price**
4. **Market naturally settles at 70-30**

### Important Notes

- **Leverage Still Works**: Leverage is independent of market price. A 70% price with 10x leverage still requires 7% margin (70/10 = 7 USDC for 100 USDC notional).
- **YES + NO = 1 USDC Always**: The invariant is maintained through the minting/burning mechanism.
- **Price Persistence**: Once established at 70-30, price remains until orders change it.

---

## Order Types & Execution

### 1. Limit Orders

#### Placing a Limit Order

```typescript
await program.methods.placeLimitOrder(
  orderId: u64,        // Unique order ID
  outcomeId: u8,       // Which outcome (0, 1, 2...)
  side: u8,            // 0 = Buy, 1 = Sell
  price: u64,          // 1-10000 basis points (1% = 100 bps)
  quantity: u64,       // Share quantity in lamports
  leverage: u8         // 1-10x leverage
).rpc();
```

**Example: Buy 100 YES shares at 60% with 5x leverage**
```typescript
// Contract Calculation (from place_limit_order):
// notional = (quantity * price) / BASIS_POINTS
//          = (100 * 6000) / 10000 = 60 USDC
// required_margin = notional / leverage = 60 / 5 = 12 USDC
// min_margin = (notional * INITIAL_MARGIN_BPS) / BASIS_POINTS
//            = (60 * 2000) / 10000 = 12 USDC
// required_margin = max(12, 12) = 12 USDC ✅

await placeLimitOrder(
  12345,        // orderId
  0,            // YES outcome
  0,            // Buy side
  6000,         // 60% = 6000 bps
  usdcToLamports(100), // 100 shares (in lamports with 6 decimals)
  5             // 5x leverage
);
// Margin deposited: 12 USDC (1,200,000 lamports)
```

**What Happens**:
1. User's USDC (margin) transferred to order escrow
2. `PendingOrder` account created with status `Open`
3. Order waits for matching sell order
4. When matched, margin is used from escrow
5. User receives YES/NO shares based on side

### 2. Market Orders

#### Placing a Market Order

```typescript
await program.methods.placeMarketOrder(
  orderId: u64,
  outcomeId: u8,
  side: u8,            // 0 = Buy, 1 = Sell
  quantity: u64,       // Share quantity
  maxSlippageBps: u64, // Max slippage (e.g., 100 = 1%)
  leverage: u8         // 1-10x leverage
).rpc();
```

**Example: Buy 50 YES shares immediately with 1% max slippage**
```typescript
// Contract Calculation (from place_market_order):
// current_price = market.outcomes[0].last_price (e.g., 6000 = 60%)
// max_slippage_bps = 100 (1%)
// aggressive_price = min(10000, current_price + max_slippage_bps)
//                  = min(10000, 6000 + 100) = 6100 (61%)
// notional = (quantity * aggressive_price) / BASIS_POINTS
//          = (50 * 6100) / 10000 = 30.5 USDC
// required_margin = max(notional / leverage, notional * 20%)
//                 = max(30.5 / 1, 30.5 * 0.20) = max(30.5, 6.1) = 30.5 USDC

await placeMarketOrder(
  67890,
  0,            // YES outcome
  0,            // Buy
  usdcToLamports(50), // 50 shares
  100,          // 1% max slippage = 100 bps
  1             // 1x leverage (no leverage)
);
// Margin deposited: 30.5 USDC (worst case at 61% price)
```

**What Happens**:
1. **Order Created**: `PendingOrder` created with `order_type = Market`, `is_maker = false`
2. **Price Set**: Order price set to `aggressive_price` (current_price + slippage for buy)
3. **Execution**: Keeper service matches with existing limit orders
4. **If No Match**: Order waits in order book as a limit order at aggressive price
5. **Fees**: Always pays taker fees (dynamic) since `is_maker = false`

### 3. Order Execution Flow

#### Step-by-Step Matching Process

```
1. Keeper Service Detects Matching Orders
   ↓
2. validateMatch()
   - Validates both orders
   - Creates MatchState PDA
   - Sets buy_is_maker and sell_is_maker flags
   ↓
3. executeBuyerMatch()
   - Mints YES shares to buyer
   - Transfers USDC from buyer escrow to market vault
   - Calculates and applies buyer fees
   - Updates buyer position
   - Marks buy_executed = true
   ↓
4. executeSellerMatch()
   - Mints NO shares to seller
   - Calculates and applies seller fees
   - Updates seller position
   - Updates market price (market.outcomes[].lastPrice)
   - Adds price snapshot for TWAP
   - Marks sell_executed = true, executed = true
```

### 4. Order Cancellation

```typescript
await program.methods.cancelOrder(orderId: u64).rpc();
```

**What Happens**:
1. Order status changed to `Cancelled`
2. Unused margin returned from escrow to user
3. Any filled portion remains executed

**Cancellation Rules**:
- ✅ Can cancel `Open` orders
- ✅ Can cancel `PartiallyFilled` orders (only unfilled portion)
- ❌ Cannot cancel `Filled` or already `Cancelled` orders

---

## Leverage Trading

### How Leverage Works

**Core Formula**:
```
Notional Value = Quantity × Price
Required Margin = Notional / Leverage
Minimum Margin = max(Notional / Leverage, Notional × 20%)
```

**Example Scenarios**:

#### Scenario 1: Buy 100 YES at 60% with 5x Leverage
```
Contract Calculation:
  quantity = 100 shares (in lamports: 100,000,000)
  price = 6000 bps (60%)
  leverage = 5
  
  notional = (100 × 6000) / 10000 = 60 USDC
  leverage_margin = 60 / 5 = 12 USDC
  min_margin = (60 × 2000) / 10000 = 12 USDC
  required_margin = max(12, 12) = 12 USDC ✅

If price goes to 70% (7000 bps):
  Position Value = (100 × 7000) / 10000 = 70 USDC
  Entry Value = (100 × 6000) / 10000 = 60 USDC
  PnL = 70 - 60 = 10 USDC
  ROI = 10 / 12 = 83.3% (vs 16.7% without leverage)
  
  Note: Position collateral tracks margin used, not full notional
```

#### Scenario 2: Buy 1000 YES at 50% with 10x Leverage
```
Contract Calculation:
  quantity = 1000 shares
  price = 5000 bps (50%)
  leverage = 10
  
  notional = (1000 × 5000) / 10000 = 500 USDC
  leverage_margin = 500 / 10 = 50 USDC
  min_margin = (500 × 2000) / 10000 = 100 USDC
  required_margin = max(50, 100) = 100 USDC ✅
  
  Note: At 10x leverage, minimum margin (20%) is higher than leverage margin (10%)

If price goes to 55% (5500 bps):
  Position Value = (1000 × 5500) / 10000 = 550 USDC
  Entry Value = (1000 × 5000) / 10000 = 500 USDC
  PnL = 550 - 500 = 50 USDC
  ROI = 50 / 100 = 50% (vs 10% without leverage)
```

### Leverage Limits

- **Minimum Leverage**: 1x (no leverage)
- **Maximum Leverage**: 10x
- **Enforced**: Program validates `leverage >= 1 && leverage <= 10`

### Margin Requirements

#### Initial Margin
- **Minimum**: 20% of notional value
- **Formula**: `margin >= max(notional / leverage, notional × 0.20)`

#### Maintenance Margin
- **Threshold**: 10% of position value (MAINTENANCE_MARGIN_BPS = 1000)
- **Used For**: Liquidation checks in `liquidate_position()`
- **Formula**: 
  ```rust
  position_value = (shares * current_price) / BASIS_POINTS
  equity = max(0, collateral + pnl)
  maintenance_requirement = (position_value * MAINTENANCE_MARGIN_BPS) / BASIS_POINTS
  liquidatable = equity < maintenance_requirement
  ```

#### Liquidation Process
When `equity < maintenance_requirement`:
1. Position becomes liquidatable (anyone can call `liquidatePosition()`)
2. **Partial Liquidation**: 25% of position liquidated (LIQUIDATION_STEP_BPS = 2500)
3. **Penalty Calculation**: 10% of liquidation value (LIQUIDATION_PENALTY_BPS = 1000)
4. **Liquidator Reward**: 50% of penalty (penalty / 2)
5. **Insurance Fund**: Remaining 50% of penalty goes to insurance fund

**Contract Code**:
```rust
liquidation_amount = (position.shares * LIQUIDATION_STEP_BPS) / BASIS_POINTS  // 25%
liquidation_value = (liquidation_amount * current_price) / BASIS_POINTS
penalty = (liquidation_value * LIQUIDATION_PENALTY_BPS) / BASIS_POINTS  // 10%
liquidator_reward = penalty / 2  // 50% of penalty
insurance_fund.balance += penalty - liquidator_reward  // Other 50%
```

---

## Position Management

### Opening a Position

Positions are created automatically when orders are filled:

```typescript
// Position Structure
{
  user: Pubkey,
  market: Pubkey,
  outcomeId: u8,
  side: u8,              // 0 = Long (YES), 1 = Short (NO)
  shares: u64,           // Number of shares
  avgEntryPrice: u64,    // Weighted average entry price
  leverage: u8,          // Leverage used
  collateral: u64        // USDC collateral locked
}
```

**Position Creation Example**:
```typescript
// User places buy order
await placeLimitOrder(orderId, 0, 0, 6000, usdcToLamports(100), 5);

// Order gets matched
// → Position automatically created with:
//   - shares: 100
//   - avgEntryPrice: 6000 (60%)
//   - leverage: 5
//   - collateral: 12 USDC (margin deposited)
```

### Closing a Position

```typescript
await program.methods.closePosition().accounts({
  market: marketPDA,
  position: positionPDA,
  user: userKey,
  // ... token accounts
}).rpc();
```

**What Happens** (from contract `close_position`):
1. **Reads current market price**: `market.outcomes[position.outcome_id].last_price`
   - **CRITICAL**: Uses on-chain market price, NOT user input
2. **Calculates PnL**:
   ```rust
   position_value = (shares * current_price) / BASIS_POINTS
   entry_value = (shares * avg_entry_price) / BASIS_POINTS
   
   // Long position (side = 0)
   pnl = position_value - entry_value
   
   // Short position (side = 1)
   pnl = entry_value - position_value
   ```
3. **Calculates payout**: `payout = max(0, collateral + pnl)`
   - Uses `saturating` arithmetic to prevent underflow
4. **Burns shares**: 
   - Long: Burns YES shares from user's token account
   - Short: Burns NO shares from user's token account
5. **Transfers USDC**: Payout sent from market vault to user's USDC account
6. **Resets position**: `shares = 0`, `collateral = 0`

**Example: Close Long Position at Profit**
```typescript
// Position State:
//   shares = 100 (in lamports: 100,000,000)
//   avg_entry_price = 6000 bps (60%)
//   collateral = 12 USDC (1,200,000 lamports)
//   side = 0 (long)

// Contract reads: market.outcomes[0].last_price = 7000 bps (70%)

// Contract Calculation:
position_value = (100 × 7000) / 10000 = 70 USDC
entry_value = (100 × 6000) / 10000 = 60 USDC
pnl = 70 - 60 = 10 USDC (positive for long)
payout = max(0, 12 + 10) = 22 USDC

// User receives 22 USDC (12 original collateral + 10 profit)
// YES shares burned: 100 shares
```

**Example: Close Long Position at Loss**
```typescript
// Position State:
//   shares = 100
//   avg_entry_price = 6000 bps (60%)
//   collateral = 12 USDC
//   side = 0 (long)

// Contract reads: market.outcomes[0].last_price = 5000 bps (50%)

// Contract Calculation:
position_value = (100 × 5000) / 10000 = 50 USDC
entry_value = (100 × 6000) / 10000 = 60 USDC
pnl = 50 - 60 = -10 USDC (negative for long)
payout = max(0, 12 + (-10)) = max(0, 2) = 2 USDC

// User receives 2 USDC (12 - 10 loss)
// YES shares burned: 100 shares
// Note: Payout cannot go negative (protected by max(0, ...))
```

### Partial Position Updates

When multiple fills occur, position averages entry price (from contract `execute_buyer_match`):

```rust
// Fill 1: 50 shares at 6000 bps (60%)
// Fill 2: 50 shares at 6500 bps (65%)

// Contract Calculation:
if position.shares == 0 {
    // First fill: Direct assignment
    position.avg_entry_price = 6000
    position.shares = 50
} else {
    // Subsequent fills: Weighted average
    total_value = (position.shares * position.avg_entry_price) + (fill_quantity * match_price)
                 = (50 * 6000) + (50 * 6500) = 625,000
    total_shares = position.shares + fill_quantity = 50 + 50 = 100
    position.avg_entry_price = total_value / total_shares = 625,000 / 100 = 6250 bps (62.5%)
    position.shares = 100
}
```

**Important**: Contract validates `total_shares > 0` before division to prevent division by zero.

### Position Limits

- **Maximum Position Size**: Limited by available market liquidity
- **No explicit caps**: But larger positions face slippage and liquidity risk

---

## Price Discovery & Updates

### Price Update Mechanism

**When Price Updates**:
- After every trade execution (in `executeSellerMatch`)
- Price stored in `market.outcomes[outcome_id].last_price`
- Price snapshots added for TWAP calculation

**Price Calculation**:
```rust
// In executeSellerMatch
let match_price = match_state.match_price; // Price from order match
add_price_snapshot(market, outcome_id, match_price);
market.outcomes[outcome_id].last_price = match_price;
```

### Price Impact of Large Orders

#### Scenario: Large Buy Order

**Initial State**:
- Order book: 1000 YES available at 60-70%
- Current price: 65%

**Large Buy (5000 YES at market)**:
```
1. Matches 1000 YES at 60-70% → Average 65%
2. Remaining 4000 YES must find higher sellers
3. Order book depth determines execution price
4. If insufficient depth → Slippage occurs
5. Final price might be 75-80% after large buy
```

**Impact**:
- Price increases (demand > supply)
- Existing holders benefit (paper profit)
- New buyers face higher entry price

#### Scenario: Large Sell Order

**Initial State**:
- Order book: 2000 YES bids at 60-70%
- Current price: 65%

**Large Sell (5000 YES at market)**:
```
1. Matches 2000 YES at 60-70% → Average 65%
2. Remaining 3000 YES must find lower buyers
3. If no bids → Price drops significantly
4. Final price might be 40-50% after large sell
```

**Impact**:
- Price decreases (supply > demand)
- Existing holders face losses
- New buyers get better entry price

### Price Stability Mechanisms

1. **Maker-Taker Fee Model**
   - Makers (limit orders): 0% fees
   - Takers (market orders): Dynamic fees (0.02% - 2%)
   - Encourages limit order placement (adds liquidity)

2. **Leverage Limits**
   - Max 10x leverage prevents extreme position sizes
   - Reduces impact of single large trade

3. **Maintenance Margin**
   - Forces liquidations before extreme losses
   - Prevents positions from going too far negative

---

## Market Resolution

### Resolution Types

#### 1. TWAP (Time-Weighted Average Price)

**How It Works**:
```
1. Price snapshots collected during trading
2. TWAP calculated over last hour (3600 seconds)
3. Winning outcome = highest average price
4. Resolver calls resolveMarketTwap(outcomeId)
```

**Example**:
```typescript
await program.methods.resolveMarketTwap(
  0 // outcomeId (YES)
).accounts({
  market: marketPDA,
  config: configPDA,
  resolver: resolverKey, // Must be market creator or admin
}).rpc();
```

**Requirements**:
- Market must be past `endDate`
- Market status must be `Active`
- Resolver must be market creator or admin

#### 2. Oracle Resolution

**How It Works**:
```
1. Oracle (authorized) calls resolveMarketOracle()
2. Provides winning outcome and evidence hash
3. Challenge period begins (24 hours)
4. Anyone can challenge by posting bond
5. After challenge period, resolution finalized
```

**Example**:
```typescript
const evidenceHash = new Uint8Array(32); // 32-byte hash

await program.methods.resolveMarketOracle(
  0, // outcomeId
  Array.from(evidenceHash) // Optional evidence
).accounts({
  market: marketPDA,
  config: configPDA,
  oracle: oracleKey, // Must be creator or admin
  resolutionSource: sourceKey, // Oracle source account
}).rpc();
```

#### 3. Challenge Resolution

**How It Works**:
```
1. During 24-hour challenge period
2. Challenger posts bond (USDC)
3. Market status → Disputed
4. Resolution handled off-chain or extended challenge period
```

**Example**:
```typescript
await program.methods.challengeResolution(
  usdcToLamports(1000) // Bond amount
).accounts({
  market: marketPDA,
  challenger: challengerKey,
  challengerUsdc: challengerUsdcATA,
  // ...
}).rpc();
```

#### 4. Finalize Resolution

**How It Works**:
```
1. After challenge period expires (or dispute resolved)
2. Anyone can call finalizeResolution()
3. Market status → Finalized
4. Users can now redeem winning shares
```

**Example**:
```typescript
await program.methods.finalizeResolution().accounts({
  market: marketPDA,
  config: configPDA,
  finalizer: finalizerKey,
}).rpc();
```

---

## Complete Market Lifecycle Example

### Example 1: Binary Market - "Will BTC hit $100k by 2025?"

#### Step 1: Market Initialization
```typescript
const marketId = Date.now();
const endDate = Math.floor(new Date('2025-12-31').getTime() / 1000);

await initializeMarket({
  marketId,
  title: "Will BTC hit $100k by 2025?",
  description: "Binary market on Bitcoin price target",
  category: 1, // Crypto category
  endDate,
  outcomeLabels: ['YES', 'NO'],
  initialCollateral: usdcToLamports(500), // 500 USDC
  resolutionType: 1 // Oracle
});
```

**Result**: Market created, prices at 50-50

#### Step 2: Bootstrap to 70-30
```typescript
// Creator mints 1000 shares
await mintShares({
  market: marketPDA,
  outcomeId: 0,
  amount: usdcToLamports(1000)
});

// Creator sells 700 YES at 70%
await placeLimitOrder(
  1, 0, 1, 7000, usdcToLamports(700), 1
);

// First buyer matches (triggers price update)
await placeMarketOrder(
  2, 0, 0, usdcToLamports(1), 100, 1
);
```

**Result**: Market price now 70-30

#### Step 3: Traders Enter with Leverage
```typescript
// Bull trader: Buy 1000 YES at 75% with 5x leverage
// Contract Calculation:
//   notional = (1000 × 7500) / 10000 = 750 USDC
//   leverage_margin = 750 / 5 = 150 USDC
//   min_margin = (750 × 2000) / 10000 = 150 USDC
//   required_margin = max(150, 150) = 150 USDC ✅
await placeLimitOrder(
  3,              // orderId
  0,              // outcomeId (YES)
  0,              // side (buy)
  7500,           // price (75% = 7500 bps)
  usdcToLamports(1000), // quantity
  5               // leverage (5x)
);
// Margin deposited: 150 USDC

// Bear trader: Sell 500 YES at 70% with 3x leverage
// Contract Calculation:
//   notional = (500 × 7000) / 10000 = 350 USDC
//   leverage_margin = 350 / 3 = 116.67 USDC
//   min_margin = (350 × 2000) / 10000 = 70 USDC
//   required_margin = max(116.67, 70) = 116.67 USDC ✅
await placeLimitOrder(
  4,              // orderId
  0,              // outcomeId
  1,              // side (sell)
  7000,           // price (70% = 7000 bps)
  usdcToLamports(500), // quantity
  3               // leverage (3x)
);
// Margin deposited: 116.67 USDC
```

#### Step 4: Orders Match
```typescript
// Keeper service finds match between orders 3 and 4
// Step 1: validateMatch(buyOrderId=3, sellOrderId=4, matchPrice=7250, matchQuantity=500)
//   - Creates MatchState PDA
//   - Calculates: fill_quantity = min(1000, 500) = 500
//   - Calculates: trade_value = (500 × 7250) / 10000 = 362.5 USDC
//   - Determines: buy_is_maker = true (limit order), sell_is_maker = true (limit order)

// Step 2: executeBuyerMatch()
//   - Mints 500 YES shares to bull trader
//   - Transfers 362.5 USDC from bull's escrow to market vault
//   - Fee: 0% (maker) = 0 USDC
//   - Updates bull's position: shares += 500, avg_entry_price = 7250
//   - Sets: buy_executed = true

// Step 3: executeSellerMatch()
//   - Mints 500 NO shares to bear trader
//   - Fee: 0% (maker) = 0 USDC
//   - Updates bear's position: shares += 500, avg_entry_price = 7250
//   - Updates market price: market.outcomes[0].last_price = 7250 (72.5%)
//   - Adds price snapshot for TWAP
//   - Sets: sell_executed = true, executed = true

// Result:
// - Bull receives 500 YES shares (position: 500 shares @ 72.5%)
// - Bear receives 500 NO shares (position: 500 shares @ 72.5%)
// - Market price updates to 72.5% (match_price)
// - Both pay 0% fees (both are makers)
// - Maker rewards tracked: 0 (no fees saved)
```

#### Step 5: Price Moves (Large Buy)
```typescript
// Whale buys 5000 YES at market
await placeMarketOrder(
  5, 0, 0, usdcToLamports(5000), 200, 2
);

// Result:
// - Price jumps to 80-20
// - Early holders see 8% gain (80% vs 72.5%)
// - Bear trader's position loses value
```

#### Step 6: Position Management
```typescript
// Bull closes position at 80%
await closePosition({
  market: marketPDA,
  outcomeId: 0,
  side: 0
});

// PnL Calculation:
// Entry: 500 shares at 72.5% = 362.5 USDC notional
// Exit: 500 shares at 80% = 400 USDC notional
// PnL = 400 - 362.5 = 37.5 USDC
// With 5x leverage: ROI = 37.5 / 72.5 = 51.7%
```

#### Step 7: Bear Gets Liquidated
```typescript
// Bear's position: 500 NO at 70%, 3x leverage
// Market price now 80%, so NO price = 20% (implicitly, since YES + NO = 100%)

// Contract Calculation (from liquidate_position):
//   current_price = 2000 bps (20% for NO, since YES is 80%)
//   position_value = (500 × 2000) / 10000 = 100 USDC
//   entry_value = (500 × 7000) / 10000 = 350 USDC
//   pnl = 350 - 100 = 250 USDC (positive for short, but position loses value)
//   Wait, for short: pnl = entry_value - position_value = 350 - 100 = 250 USDC
//   Actually: pnl = entry_value - position_value = 350 - 100 = 250 USDC
//   But this is wrong... Let me check the contract logic:
//   
//   In liquidate_position:
//   pnl = if side == 0 { position_value - entry_value }
//         else { entry_value - position_value }
//   
//   For short (side = 1): pnl = entry_value - position_value = 350 - 100 = 250 USDC
//   equity = max(0, collateral + pnl) = max(0, 116.67 + 250) = 366.67 USDC
//   
//   Wait, that doesn't make sense. Let me re-read...
//   
//   Actually, for a SHORT position:
//   - Entry: Sold at 70%, so entry_value represents what was received
//   - Current: Price is 20%, so position value is what it costs to buy back
//   - PnL for short = entry_value - position_value = 350 - 100 = 250 USDC profit
//   
//   But if price went from 70% to 20%, the short should be PROFITABLE, not losing.
//   
//   Let me check the contract again... Actually, the issue is that for NO shares:
//   - When you sell YES at 70%, you get NO shares
//   - NO price = 100% - YES price = 30% initially, 20% now
//   - So NO price went DOWN (30% → 20%), which means short is PROFITABLE
//   
//   Correct calculation:
//   entry_value (NO at 30%) = 500 × 0.30 = 150 USDC
//   position_value (NO at 20%) = 500 × 0.20 = 100 USDC
//   pnl = 150 - 100 = 50 USDC profit
//   equity = 116.67 + 50 = 166.67 USDC
//   maintenance = 100 × 10% = 10 USDC
//   
//   Equity (166.67) > Maintenance (10) → NOT liquidatable
//   
//   For liquidation to occur, price must move AGAINST the position:
//   If NO price goes to 90% (YES to 10%):
//   position_value = 500 × 0.90 = 450 USDC
//   entry_value = 500 × 0.30 = 150 USDC
//   pnl = 150 - 450 = -300 USDC (loss)
//   equity = max(0, 116.67 - 300) = 0 USDC
//   maintenance = 450 × 10% = 45 USDC
//   equity (0) < maintenance (45) → LIQUIDATABLE ✅

// Correct liquidation scenario:
// Market price: YES = 10%, NO = 90%
await liquidatePosition(marketPDA, bearPositionPDA);

// Contract Calculation:
//   liquidation_amount = (500 × 2500) / 10000 = 125 shares (25%)
//   liquidation_value = (125 × 9000) / 10000 = 112.5 USDC
//   penalty = (112.5 × 1000) / 10000 = 11.25 USDC (10%)
//   liquidator_reward = 11.25 / 2 = 5.625 USDC

// Result:
// - 125 shares liquidated (25% of position)
// - 11.25 USDC penalty
// - Liquidator receives 5.625 USDC reward
// - Insurance fund receives 5.625 USDC
// - Position: shares = 375, collateral reduced
```

#### Step 8: Market Resolution
```typescript
// Dec 31, 2025 - BTC is at $105k
// Oracle resolves YES

await resolveMarketOracle(
  0, // YES outcome
  evidenceHash // Proof of BTC price
);

// Wait 24 hours (challenge period)
await finalizeResolution();

// Result:
// - YES holders can redeem shares for 1 USDC each
// - NO holders receive nothing
// - Market status → Finalized
```

---

## Example 2: Leverage Limit Order with Big Buy Impact

### Setup
- Market: "ETH > $5000 by end of year"
- Current price: 60% YES, 40% NO
- Order book depth: 1000 YES at 58-62%

### Scenario: Trader Opens 10x Leverage Position
```typescript
// Trader places limit buy order
await placeLimitOrder(
  1001,
  0,      // YES outcome
  0,      // Buy
  6000,   // 60%
  usdcToLamports(10000), // 10,000 shares
  10      // 10x leverage
);

// Calculation:
// Notional = 10,000 × 0.60 = 6,000 USDC
// Margin = 6,000 / 10 = 600 USDC
// Minimum Margin = 6,000 × 20% = 1,200 USDC
// Required Margin = max(600, 1,200) = 1,200 USDC ✅

// Order waits for matching sell orders
```

### Large Buy Hits Market
```typescript
// Whale places market buy for 50,000 YES
await placeMarketOrder(
  2000,
  0,
  0,
  usdcToLamports(50000),
  300,  // 3% max slippage
  1
);

// Execution:
// 1. Matches existing orders up to 62% (10,000 shares)
// 2. Remaining 40,000 shares need new sellers
// 3. Price discovery: New sell orders appear at 65-70%
// 4. Final execution: Average price ~68%
// 5. Market price updates to 68%

// Impact on trader's limit order:
// - Trader's order at 60% gets filled
// - Execution price: 60-68% average = ~64%
// - Receives 10,000 YES at effective 64% price
```

### Position Management After Large Buy
```typescript
// Trader's position:
// - Shares: 10,000 YES
// - Entry: 64% (weighted average)
// - Current market price: 68%
// - Collateral: 1,200 USDC
// - Leverage: 10x

// PnL Calculation:
Position Value = 10,000 × 0.68 = 6,800 USDC
Entry Value = 10,000 × 0.64 = 6,400 USDC
PnL = 6,800 - 6,400 = +400 USDC
Equity = 1,200 + 400 = 1,600 USDC

// ROI = 400 / 1,200 = 33.3% (vs 6.25% without leverage)
```

### Cancellation During Volatility
```typescript
// Trader's order was partially filled (say 5,000 shares)
// Remaining 5,000 shares still waiting

// If trader wants to cancel unfilled portion:
await cancelOrder(1001);

// Result:
// - Filled portion (5,000 shares): Kept in position
// - Unfilled portion (5,000 shares): Cancelled
// - Margin returned for unfilled: 600 USDC returned
// - Remaining margin: 600 USDC (for 5,000 filled shares)
```

---

## Key Takeaways

### For Market Creators
1. **Minimum 5 USDC required**, but 100-500 USDC recommended for liquidity
2. **Prices start at 50-50** - Use minting + limit orders to bootstrap to 70-30
3. **Larger initial collateral** = More confidence for traders
4. **Set realistic end dates** and choose appropriate resolution type

### For Liquidity Providers
1. **Mint shares** when market is at 50% (risk-free)
2. **Burn shares** anytime to exit (1:1 USDC return)
3. **Earn maker fees** by providing limit orders (0% fee)

### For Traders
1. **Leverage amplifies gains AND losses** - Use cautiously
2. **Limit orders** = 0% fees (maker)
3. **Market orders** = Dynamic fees (taker: 0.02% - 2%)
4. **Close positions early** using current market price
5. **Watch for liquidation** if position goes against you

### For Developers/Keepers
1. **Monitor order book** for matching opportunities
2. **Execute matches** in sequence: validateMatch → executeBuyerMatch → executeSellerMatch
3. **Price updates** happen automatically in executeSellerMatch
4. **Track MatchState.executed** to prevent double execution

---

## Contract Invariants

1. **YES + NO = 1 USDC Always**: Maintained through mint/burn mechanism
2. **Prices in Basis Points**: 1% = 100 bps, 100% = 10,000 bps
3. **Leverage Bounds**: 1-10x enforced programmatically
4. **Margin Requirements**: Minimum 20% initial, 10% maintenance
5. **Price Updates**: Only on successful order execution

---

## Program IDs & PDAs Reference

### Key Program Addresses
- **Program ID**: `6e92wMrut8NyK6k4N8dnsUGzAVPdzMYwzqsv3gYccGv8`

### Important PDAs
```typescript
// Market
market = [b"market", creator, market_id]
market_vault = [b"vault", market]
vault_authority = [b"vault_authority", market]

// Mints
no_mint = [b"no_mint", market]
yes_mint = [b"yes_mint", market, outcome_id]
mint_authority = [b"mint_authority", market]

// Orders
pending_order = [b"order", user, order_id]
order_escrow = [b"order_escrow", user, order_id]
order_escrow_authority = [b"order_escrow_authority", user, order_id]

// Positions
position = [b"position", user, market, outcome_id, side]

// Match State
match_state = [b"match", market, buy_order_id, sell_order_id]

// Protocol
config = [b"config"]
insurance_fund = [b"insurance_fund"]
insurance_vault = [b"insurance_vault"]
```

---

## Support & Additional Resources

- **Contract Source**: `lib_solana_playground_FINAL.rs`
- **Frontend Hooks**: `frontend/src/hooks/useSpaceProgram.ts`
- **Backend Service**: `backend/src/services/orderKeeperService.ts`
- **Space Documentation**: https://docs.into.space/

---

*Last Updated: Based on contract version with MatchState security fixes and dynamic fee implementation*

