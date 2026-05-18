import { PublicKey } from '@solana/web3.js';
import BN from 'bn.js';

export enum PositionSide {
  LONG = 'long', // YES shares
  SHORT = 'short', // NO shares
}

export interface Position {
  id: string;
  publicKey: PublicKey;
  marketId: string;
  outcomeId: string;
  user: PublicKey;
  side: PositionSide;
  shares: BN;
  avgEntryPrice: BN;
  leverage: number;
  collateral: BN; // USDC collateral
  pnl: BN; // Realized + Unrealized PnL
  unrealizedPnl: BN;
  realizedPnl: BN;
  liquidationPrice: BN | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface Portfolio {
  user: PublicKey;
  totalValue: BN; // Total portfolio value in USDC
  totalCollateral: BN;
  totalPnl: BN;
  positions: Position[];
  openPositions: number;
  closedPositions: number;
}






