import { PublicKey } from '@solana/web3.js';
import BN from 'bn.js';

export enum MarketCategory {
  CRYPTO = 'crypto',
  POLITICS = 'politics',
  SPORTS = 'sports',
  TECHNOLOGY = 'technology',
  ECONOMICS = 'economics',
  CULTURE = 'culture',
}

export enum MarketStatus {
  ACTIVE = 'active',
  RESOLVED = 'resolved',
  CLOSED = 'closed',
  PENDING_RESOLUTION = 'pending_resolution',
}

export enum ResolutionSource {
  BLOCKCHAIN_DATA = 'blockchain_data',
  ORACLE = 'oracle',
  ADMIN = 'admin',
}

export interface MarketOutcome {
  id: string;
  label: string;
  sharePrice: BN; // Price in basis points (0-10000, representing 0-1.0)
  totalShares: BN;
  liquidity: BN; // USDC amount
}

export interface Market {
  id: string;
  publicKey: PublicKey;
  creator: PublicKey;
  title: string;
  description: string;
  category: MarketCategory;
  outcomes: MarketOutcome[];
  status: MarketStatus;
  resolutionSource: ResolutionSource | null;
  resolutionData: string | null; // Encoded resolution data
  resolvedOutcome: string | null; // ID of resolved outcome
  endDate: Date;
  createdAt: Date;
  totalVolume: BN;
  totalLiquidity: BN;
}

export interface MarketStats {
  marketId: string;
  totalVolume: BN;
  totalLiquidity: BN;
  openInterest: BN;
  uniqueTraders: number;
  lastPriceUpdate: Date;
}






