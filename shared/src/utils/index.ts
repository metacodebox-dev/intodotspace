import BN from 'bn.js';
import { BASIS_POINTS, FEE_DENOMINATOR, MAINTENANCE_MARGIN_BPS, INITIAL_MARGIN_BPS } from '../constants';

/**
 * Convert basis points to decimal (e.g., 5000 -> 0.5)
 */
export function bpsToDecimal(bps: BN): number {
  return bps.toNumber() / BASIS_POINTS;
}

/**
 * Convert decimal to basis points (e.g., 0.5 -> 5000)
 */
export function decimalToBps(decimal: number): BN {
  return new BN(Math.floor(decimal * BASIS_POINTS));
}

/**
 * Calculate dynamic taker fee based on position size and market conditions
 * Fee ranges from 0.02% to 2%
 */
export function calculateTakerFee(
  orderSize: BN,
  totalVolume: BN,
  baseFeeBps: number = 20 // 0.2% base
): BN {
  // Fee increases with order size relative to total volume
  const volumeForCalc = totalVolume.gt(new BN(0)) ? totalVolume : new BN(1);
  const sizeRatio = orderSize.mul(new BN(BASIS_POINTS)).div(volumeForCalc);
  const sizeMultiplier = Math.min(sizeRatio.toNumber() / BASIS_POINTS, 10); // Max 10x
  
  // Calculate fee: base * (1 + sizeMultiplier)
  const feeBps = Math.floor(baseFeeBps * (1 + sizeMultiplier * 0.9));
  const clampedFee = Math.max(2, Math.min(200, feeBps)); // Clamp between 0.02% and 2%
  
  return new BN(clampedFee);
}

/**
 * Calculate fee amount from order amount and fee basis points
 */
export function calculateFeeAmount(amount: BN, feeBps: BN): BN {
  return amount.mul(feeBps).div(new BN(FEE_DENOMINATOR));
}

/**
 * Calculate PnL for a position
 */
export function calculatePnL(
  shares: BN,
  entryPrice: BN,
  currentPrice: BN,
  side: 'long' | 'short'
): BN {
  if (side === 'long') {
    // Long: profit when price goes up
    return currentPrice.sub(entryPrice).mul(shares).div(new BN(BASIS_POINTS));
  } else {
    // Short: profit when price goes down
    return entryPrice.sub(currentPrice).mul(shares).div(new BN(BASIS_POINTS));
  }
}

/**
 * Calculate liquidation price for a leveraged position
 * Based on maintenance margin requirement
 * For long: liquidation when price drops to entryPrice * (1 - (1/leverage - maintenance_margin))
 * For short: liquidation when price rises to entryPrice * (1 + (1/leverage - maintenance_margin))
 */
export function calculateLiquidationPrice(
  entryPrice: BN,
  leverage: number,
  side: 'long' | 'short'
): BN {
  // Maintenance margin as fraction (e.g., 5% = 0.05)
  const maintenanceMargin = MAINTENANCE_MARGIN_BPS;
  const leverageBps = new BN(leverage).mul(new BN(BASIS_POINTS));
  
  if (side === 'long') {
    // Long position: liquidation when price drops
    // Formula: entryPrice * (1 - (1/leverage - maintenance_margin))
    // Simplified: entryPrice * (maintenance_margin + leverage_ratio)
    const leverageRatio = BASIS_POINTS / leverage; // 1/leverage in basis points (e.g., 1000 for 10x)
    const marginRatio = leverageRatio - maintenanceMargin;
    return entryPrice.mul(new BN(BASIS_POINTS - marginRatio)).div(new BN(BASIS_POINTS));
  } else {
    // Short position: liquidation when price rises
    const leverageRatio = BASIS_POINTS / leverage;
    const marginRatio = leverageRatio - maintenanceMargin;
    return entryPrice.mul(new BN(BASIS_POINTS + marginRatio)).div(new BN(BASIS_POINTS));
  }
}

/**
 * Calculate required collateral for a leveraged position
 * collateral = position_value / leverage
 */
export function calculateRequiredCollateral(
  positionValue: BN,
  leverage: number
): BN {
  return positionValue.mul(new BN(BASIS_POINTS)).div(new BN(leverage).mul(new BN(BASIS_POINTS)));
}

/**
 * Calculate margin ratio: collateral_value / position_value
 * Returns basis points (e.g., 1000 = 10%)
 */
export function calculateMarginRatio(
  collateral: BN,
  positionValue: BN
): BN {
  if (positionValue.isZero()) {
    return new BN(0);
  }
  return collateral.mul(new BN(BASIS_POINTS)).div(positionValue);
}

/**
 * Check if a position should be liquidated
 * Liquidate when margin ratio < maintenance margin
 */
export function shouldLiquidate(
  collateral: BN,
  positionValue: BN,
  entryPrice: BN,
  currentPrice: BN,
  leverage: number,
  side: 'long' | 'short'
): boolean {
  const marginRatio = calculateMarginRatio(collateral, positionValue);
  const liquidationPrice = calculateLiquidationPrice(entryPrice, leverage, side);
  
  // Check both margin ratio and price-based liquidation
  const marginRatioLiquidated = marginRatio.lt(new BN(MAINTENANCE_MARGIN_BPS));
  
  let priceLiquidated = false;
  if (side === 'long') {
    priceLiquidated = currentPrice.lt(liquidationPrice);
  } else {
    priceLiquidated = currentPrice.gt(liquidationPrice);
  }
  
  return marginRatioLiquidated || priceLiquidated;
}

/**
 * Calculate price impact based on order size and liquidity depth
 * Returns price impact in basis points
 */
export function calculatePriceImpact(
  orderSize: BN,
  liquidity: BN,
  currentPrice: BN
): BN {
  if (liquidity.isZero()) {
    return new BN(BASIS_POINTS); // 100% impact if no liquidity
  }
  
  // Simple constant product model: price_impact = order_size / liquidity
  // Scaled to basis points
  const impactRatio = orderSize.mul(new BN(BASIS_POINTS)).div(liquidity);
  
  // Cap at 100%
  const maxImpact = new BN(BASIS_POINTS);
  return impactRatio.gt(maxImpact) ? maxImpact : impactRatio;
}

/**
 * Calculate new price after order impact
 */
export function calculatePriceAfterImpact(
  currentPrice: BN,
  orderSize: BN,
  liquidity: BN,
  side: 'buy' | 'sell'
): BN {
  const impact = calculatePriceImpact(orderSize, liquidity, currentPrice);
  
  if (side === 'buy') {
    // Buying increases price
    return currentPrice.mul(new BN(BASIS_POINTS).add(impact)).div(new BN(BASIS_POINTS));
  } else {
    // Selling decreases price
    return currentPrice.mul(new BN(BASIS_POINTS).sub(impact)).div(new BN(BASIS_POINTS));
  }
}

/**
 * Format USDC amount (6 decimals)
 */
export function formatUSDC(amount: BN): string {
  return (amount.toNumber() / 1e6).toFixed(2);
}

/**
 * Format share price (basis points to percentage)
 */
export function formatPrice(priceBps: BN): string {
  return ((priceBps.toNumber() / BASIS_POINTS) * 100).toFixed(2) + '%';
}

/**
 * Parse USDC amount to BN
 */
export function parseUSDC(amount: string): BN {
  return new BN(Math.floor(parseFloat(amount) * 1e6));
}
