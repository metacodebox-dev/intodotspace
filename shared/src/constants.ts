import BN from 'bn.js';

// Market Constants
export const MAX_LEVERAGE = 10;
export const MIN_LEVERAGE = 1;
export const BASIS_POINTS = 10000; // 1.0 = 10000 basis points
export const MAX_OUTCOMES = 10;

// Fee Constants
export const MIN_TAKER_FEE_BPS = 2; // 0.02%
export const MAX_TAKER_FEE_BPS = 200; // 2%
export const MAKER_FEE_BPS = 0; // 0% for makers
export const FEE_DENOMINATOR = 10000;

// Price Constants
export const MIN_PRICE_BPS = 1; // 0.01%
export const MAX_PRICE_BPS = 9999; // 99.99%

// Order Constants
export const MAX_ORDER_SIZE = new BN(10).pow(new BN(12)); // 1 trillion shares
export const MIN_ORDER_SIZE = new BN(1);

// Liquidity Constants
export const MIN_INITIAL_LIQUIDITY_PER_OUTCOME = new BN(5000000); // 5000 USDC minimum per outcome (6 decimals)
export const MIN_INITIAL_LIQUIDITY_TOTAL = new BN(10000000); // 10000 USDC minimum total
export const LIQUIDITY_REWARD_RATE_BPS = 100; // 1% annual

// Leverage & Margin Constants
export const MAINTENANCE_MARGIN_BPS = 500; // 5% maintenance margin (for 10x leverage)
export const INITIAL_MARGIN_BPS = 1000; // 10% initial margin requirement
export const LIQUIDATION_PENALTY_BPS = 50; // 0.5% liquidation penalty

// SPACE Token Constants
export const SPACE_TOKEN_DECIMALS = 9;
export const MIN_SPACE_FOR_MARKET = new BN(1000).mul(new BN(10).pow(new BN(SPACE_TOKEN_DECIMALS)));

// Oracle Constants
export const ORACLE_UPDATE_THRESHOLD = 60; // seconds
export const ORACLE_MAX_AGE = 3600; // 1 hour

// Market Resolution
export const RESOLUTION_DELAY = 3600; // 1 hour after event
export const DISPUTE_PERIOD = 86400; // 24 hours

// Points System
export const POINTS_PER_TRADE = new BN(10);
export const POINTS_PER_LIQUIDITY_PROVIDED = new BN(1); // per USDC
export const POINTS_PER_REFERRAL = new BN(100);

// Airdrop Constants
export const AIRDROP_SEASON_DURATION = 90 * 24 * 3600; // 90 days
export const MIN_POINTS_FOR_AIRDROP = new BN(1000);

// Flywheel Constants
export const BUYBACK_PERCENTAGE_BPS = 5000; // 50% of fees
export const BURN_PERCENTAGE_BPS = 5000; // 50% of fees
