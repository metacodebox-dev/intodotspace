import { useState, useEffect } from 'react';
import axios from 'axios';

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001';

export interface OrderBookLevel {
  price: number;
  size: number;
  orders: number;
}

export interface OrderBook {
  bids: OrderBookLevel[];
  asks: OrderBookLevel[];
  lastPrice?: number;
  spread?: number;
}

export function useOrderBook(marketId: string, outcomeId: number, depth: number = 20) {
  const [orderBook, setOrderBook] = useState<OrderBook | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  useEffect(() => {
    const fetchOrderBook = async () => {
      try {
        setLoading(true);
        const response = await axios.get(`${API_URL}/api/v1/orderbook/${marketId}/${outcomeId}`, {
          params: { depth },
        });
        
        const orderBookData = response.data.orderBook || response.data;
        setOrderBook({
          bids: Array.isArray(orderBookData.bids) ? orderBookData.bids : [],
          asks: Array.isArray(orderBookData.asks) ? orderBookData.asks : [],
          lastPrice: orderBookData.lastPrice,
          spread: orderBookData.spread,
        });
        setError(null);
      } catch (err) {
        console.error('Error fetching order book:', err);
        setError(err instanceof Error ? err : new Error('Failed to fetch order book'));
        setOrderBook(null);
      } finally {
        setLoading(false);
      }
    };

    if (marketId && outcomeId !== undefined) {
      fetchOrderBook();
      // NOTE: Polling removed - use useOrderBookWebSocket for real-time updates
      // This hook is kept for backward compatibility but should be replaced
    }
  }, [marketId, outcomeId, depth]);

  return { orderBook, loading, error };
}

export function useMarketPrice(marketId: string, outcomeId: number) {
  const [price, setPrice] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchPrice = async () => {
      try {
        const response = await axios.get(`${API_URL}/api/v1/orderbook/${marketId}/${outcomeId}/price`);
        if (response.data.price !== null && response.data.price !== undefined) {
          setPrice(response.data.price);
        }
      } catch (error) {
        console.error('Error fetching market price:', error);
        // Default to 50% if no price available
        setPrice(5000);
      } finally {
        setLoading(false);
      }
    };

    if (marketId && outcomeId !== undefined) {
      fetchPrice();
      // NOTE: Polling removed - use useMarketPriceWebSocket for real-time updates
      // This hook is kept for backward compatibility but should be replaced
    }
  }, [marketId, outcomeId]);

  return { price, loading };
}


