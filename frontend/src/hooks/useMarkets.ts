import { useState, useEffect } from 'react';
import axios from 'axios';
import { Market } from '@/types/market';

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001';

interface UseMarketsParams {
  category?: string;
  status?: string;
  limit?: number;
}

export function useMarkets(params: UseMarketsParams = {}) {
  const [markets, setMarkets] = useState<Market[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const fetchMarkets = async () => {
      setLoading(true);
      setError(null);

      try {
        const response = await axios.get(`${API_URL}/api/v1/markets`, {
          params: {
            category: params.category || undefined,
            status: params.status || 'active',
            limit: params.limit || 50,
          },
        });

        setMarkets(response.data.markets || []);
      } catch (err: any) {
        setError(err.message || 'Failed to fetch markets');
        setMarkets([]);
      } finally {
        setLoading(false);
      }
    };

    fetchMarkets();
  }, [params.category, params.status, params.limit]);

  return { markets, loading, error };
}
