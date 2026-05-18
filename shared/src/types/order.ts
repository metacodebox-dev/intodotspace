import { PublicKey } from '@solana/web3.js';
import BN from 'bn.js';

export enum OrderSide {
  BUY = 'buy',
  SELL = 'sell',
}

export enum OrderType {
  MARKET = 'market',
  LIMIT = 'limit',
}

export enum OrderStatus {
  PENDING = 'pending',
  PARTIAL = 'partial',
  FILLED = 'filled',
  CANCELLED = 'cancelled',
  REJECTED = 'rejected',
}

export interface Order {
  id: string;
  publicKey: PublicKey;
  marketId: string;
  outcomeId: string;
  user: PublicKey;
  side: OrderSide;
  type: OrderType;
  price: BN; // Limit price in basis points (0-10000)
  amount: BN; // Number of shares
  filledAmount: BN;
  remainingAmount: BN;
  status: OrderStatus;
  leverage: number; // 1-10x
  createdAt: Date;
  updatedAt: Date;
  expiresAt: Date | null;
}

export interface OrderBookLevel {
  price: BN;
  size: BN; // Total size at this price level
  orders: number; // Number of orders at this price
}

export interface OrderBook {
  marketId: string;
  outcomeId: string;
  bids: OrderBookLevel[];
  asks: OrderBookLevel[];
  lastPrice: BN | null;
  spread: BN | null;
}

export interface Trade {
  id: string;
  marketId: string;
  outcomeId: string;
  makerOrderId: string;
  takerOrderId: string;
  maker: PublicKey;
  taker: PublicKey;
  price: BN;
  amount: BN;
  fee: BN;
  feePaidBy: 'maker' | 'taker';
  timestamp: Date;
}






