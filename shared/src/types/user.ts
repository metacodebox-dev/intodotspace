import { PublicKey } from '@solana/web3.js';
import BN from 'bn.js';

export interface UserStats {
  user: PublicKey;
  totalTrades: number;
  totalVolume: BN;
  totalFeesPaid: BN;
  totalPnl: BN;
  winRate: number; // Percentage (0-100)
  avgLeverage: number;
  points: BN;
  referrals: number;
  referralRewards: BN;
}

export interface UserRewards {
  user: PublicKey;
  totalPoints: BN;
  liquidityRewards: BN;
  tradingRewards: BN;
  referralRewards: BN;
  airdropEligibility: boolean;
  nextAirdropDate: Date | null;
}






