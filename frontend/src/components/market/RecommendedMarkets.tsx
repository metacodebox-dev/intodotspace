import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useMarketsWebSocket } from '@/hooks/useMarketsWebSocket';
import Image from 'next/image';

interface RecommendedMarket {
  id?: string;
  title: string;
  chance: number;
  image?: string;
}

interface RecommendedMarketsProps {
  markets?: RecommendedMarket[];
}

// Default mock recommended markets
const defaultMarkets: RecommendedMarket[] = [
  { title: 'Next Prime Minister of the Czech Republic', chance: 33, image: '/assets/market-placeholder.png' },
  { title: 'Will Hamas release all Israeli hostages by Octo...', chance: 36, image: '/assets/market-placeholder.png' },
  { title: 'Fed decision in October?', chance: 55, image: '/assets/market-placeholder.png' },
];

export function RecommendedMarkets({ markets = defaultMarkets }: RecommendedMarketsProps) {
  const [activeTab, setActiveTab] = useState('Recommended');
  const { markets: recommendedMarkets, loading, error } = useMarketsWebSocket({ category: activeTab === 'Recommended' ? 'Trending' : 'Ending Soon' });
  const [marketList, setMarketList] = useState<any[]>([]);
  const tabs = ['Recommended', 'Ending Soon'];


  useEffect(() => {
    if (activeTab === 'Recommended') {
      const random = recommendedMarkets.slice(0, 4);
      setMarketList(random);
    } else {
      const endingSoon = recommendedMarkets.slice(3, 8);
      setMarketList(endingSoon);
    }
  }, [activeTab, recommendedMarkets]);

  return (
    <div className="overflow-hidden">
      {/* Tabs */}
      <div className="flex border-b border-[#262626]">
        {tabs.map((tab) => (
          <button
            key={tab}
            onClick={() => setActiveTab(tab)}
            className={`flex-1 px-4 py-3 text-sm font-medium transition-colors ${
              activeTab === tab 
                ? 'text-white border-b-2 border-white' 
                : 'text-gray-500 hover:text-gray-300'
            }`}
          >
            {tab}
          </button>
        ))}
      </div>

      {/* Market List */}
      <div className="p-4 space-y-3">
        {marketList.map((market, i) => (
          <Link 
            key={market.id || i} 
            href={market.id ? `/markets/${market.id}` : '#'}
            className="flex items-center gap-3 p-2 hover:bg-[#1a1a1a] rounded-lg cursor-pointer transition-colors"
          >
            <div className="w-12 h-12 rounded-lg bg-[#262626] overflow-hidden flex-shrink-0">
             {
              market.imageUrl ? (
                <Image
                  src={market.imageUrl}
                  alt={market.title}
                  width={100}
                  height={100}
                  className="w-12 h-12 rounded-lg object-cover"
                />
              ) : (
                <div className="w-full h-full bg-gradient-to-br from-gray-600 to-gray-800"></div>
              )
             } 
            </div>
            <p className="flex-1 text-sm text-gray-300 line-clamp-2">{market.title}</p>
            <span className="text-white font-bold">{(() => {
              const outcomes = market.outcomes || [];
              if (outcomes.length <= 2) {
                return (outcomes[0]?.lastPrice ? outcomes[0].lastPrice / 100 : 0) + '%';
              }
              // Multi-outcome: show highest probability
              const top = [...outcomes].sort((a: any, b: any) => (b.lastPrice || 0) - (a.lastPrice || 0))[0];
              return top ? (top.lastPrice ? top.lastPrice / 100 : 0) + '%' : '0%';
            })()}</span>
          </Link>
        ))}
      </div>
    </div>
  );
}
