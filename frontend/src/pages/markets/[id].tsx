import { useRouter } from 'next/router';
import { useEffect, useState, useRef } from 'react';
import Head from 'next/head';
import Image from 'next/image';
import axios from 'axios';
import { useWallet } from '@solana/wallet-adapter-react';
import { Layout } from '@/components/Layout';
import { Market } from '@/types/market';
import { useMarketPriceWebSocket } from '@/hooks/useOrderBookWebSocket';
import { displayQuoteSymbol } from '@/utils/solana';

// Market components
import {
  MarketHeader,
  MarketStats,
  MarketPriceChart,
  MarketOrderBookSection,
  MarketRulesSection,
  MarketComments,
  RecommendedMarkets,
  MarketPageSkeleton,
} from '@/components/market';
import { ShareMintingPanel } from '@/components/ShareMintingPanel';
import { RedeemPanel } from '@/components/RedeemPanel';
import { LiveBinancePrice } from '@/components/LiveBinancePrice';
// Trading components
import { MarketTradingPanel } from '@/components/MarketTradingPanel';
import { MarketUserOrders } from '@/components/MarketUserOrders';
import { MarketPositions } from '@/components/MarketPositions';

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001';

// Wallet addresses that can see ShareMintingPanel
const ALLOWED_WALLET_ADDRESSES = [
  'H8Bm2CRGgPMvxBo27tUCUerUyphjgQKmPkYgcnH9xav7',
  'AwgiU3uSQrgBaZX4BzLRtzW74AyEYGFBGu8inqo8YeVf',
  'AJrntLr6FVHa67cqYiSiJ6T2Evh8HTiWmEbyctX2XzFK'
];

export default function MarketPage() {
  const router = useRouter();
  const { id } = router.query;
  const { publicKey } = useWallet();
  const [market, setMarket] = useState<Market | null>(null);
  const [loading, setLoading] = useState(true);
  const [selectedOutcomeId, setSelectedOutcomeId] = useState<number>(0);
  const [selectedTokenType, setSelectedTokenType] = useState<'yes' | 'no'>('yes');
  const [showAllOutcomes, setShowAllOutcomes] = useState(false);
  const tradingPanelRef = useRef<HTMLDivElement>(null);
  
  // Check if current wallet matches any of the allowed addresses
  const canSeeShareMintingPanel = publicKey ? ALLOWED_WALLET_ADDRESSES.includes(publicKey.toString()) : false;

  // Get live price from WebSocket
  const { price: liveYesPrice } = useMarketPriceWebSocket(market?.id || '', 0);
  const yesPrice = liveYesPrice ?? 3300; // Default 33%
  const currentPricePercent = yesPrice / 100;

  useEffect(() => {
    if (id) {
      axios
        .get(`${API_URL}/api/v1/markets/${id}`)
        .then((res) => {
          const marketData = res.data.market || res.data;
          let parsedOutcomes: any[] = [];
          if (typeof marketData.outcomes === 'string') {
            try {
              parsedOutcomes = JSON.parse(marketData.outcomes);
            } catch (e) {
              parsedOutcomes = [];
            }
          } else if (Array.isArray(marketData.outcomes)) {
            parsedOutcomes = marketData.outcomes;
          }

          const transformedMarket: Market = {
            id: marketData.marketAddress || marketData.id,
            title: marketData.title,
            imageUrl: marketData.imageUrl || null,
            description: marketData.description,
            category: marketData.category?.toString() || '0',
            status: marketData.status?.toString() || '0',
            is_multi_outcome: parsedOutcomes.length > 2,
            isMultiOutcome: parsedOutcomes.length > 2,
            outcomes: parsedOutcomes.map((o: any, idx: number) => ({
              id: o.id ?? idx,
              label: o.label || '',
              share_price: o.lastPrice || o.share_price || 5000,
              lastPrice: o.lastPrice || o.share_price || 5000,
              total_shares: 0,
              liquidity: 0,
              imageUrl: o.imageUrl || null,
              subtitle: o.subtitle || null,
            })),
            end_date: marketData.endDate || marketData.end_date,
            created_at: marketData.createdAt || marketData.created_at,
            total_volume: parseInt(marketData.totalVolume || '0'),
            total_liquidity: parseInt(marketData.totalCollateral || '0'),
            creator: marketData.creator,
            resolved_outcome: marketData.resolvedOutcome,
            resolvedOutcome: marketData.resolvedOutcome,
            resolution_source: marketData.resolutionSource,
            noMint: marketData.noMint || undefined,
            // Quote-token metadata — needed so the trading panel / minting /
            // redeem flows resolve against SPACE (or any non-USDC quote) and
            // show the correct wallet balance + labels.
            quoteMint: marketData.quoteMint || undefined,
            quoteDecimals: marketData.quoteDecimals ?? undefined,
            quoteSymbol: marketData.quoteSymbol ? displayQuoteSymbol(marketData.quoteSymbol) : undefined,
            // Auto-market fields
            autoResolve: marketData.autoResolve ?? false,
            timeframeSecs: marketData.timeframeSecs ?? null,
            strikePrice: marketData.strikePrice ?? null,
            priceFeed: marketData.priceFeed ?? null,
            resolveAt: marketData.resolveAt ?? null,
          };

          setMarket(transformedMarket);
        })
        .catch((err) => console.error('Error fetching market:', err))
        .finally(() => setLoading(false));
    }
  }, [id]);

  if (loading) {
    return (
      <Layout>
        <MarketPageSkeleton />
      </Layout>
    );
  }

  if (!market) {
    return (
      <Layout>
        <div className="text-center py-32">
          <h1 className="text-2xl font-bold text-white mb-4">Market not found</h1>
          <button 
            onClick={() => router.push('/')} 
            className="px-6 py-3 bg-white text-black rounded-lg font-semibold hover:bg-gray-100 transition-colors"
          >
            Go Home
          </button>
        </div>
      </Layout>
    );
  }

  return (
    <>
      <Head>
        <title>{market.title} - Space</title>
        <meta name="description" content={market.description} />
      </Head>
      
      <Layout>
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Left Column - Main Content */}
          <div className="lg:col-span-2 flex flex-col gap-4">
            {/* Market Header */}
            <MarketHeader market={market} />

            {/* Market Stats */}
            <MarketStats market={market} yesPrice={yesPrice} />

            {/* Live Binance price — only for auto-markets */}
            {market.autoResolve && market.priceFeed && (
              <LiveBinancePrice symbol={market.priceFeed} strikePrice={market.strikePrice ?? undefined} />
            )}

            {/* Price Chart */}
            <MarketPriceChart market={market} currentPrice={currentPricePercent} />

            {/* Outcomes Section — Polymarket Style (multi-outcome only) */}
            {market.isMultiOutcome && market.outcomes.length > 0 && (() => {
              const visibleOutcomes = showAllOutcomes ? market.outcomes : market.outcomes.slice(0, 5);
              return (
                <div className="overflow-hidden">
                  <table className="w-full border-collapse">
                    {/* Header row */}
                    <thead>
                      <tr className="border-b border-[#262626]">
                        <th className="text-[#656565] font-medium text-xs text-left px-5 py-3">Outcomes</th>
                        <th className="text-[#656565] font-medium text-xs text-center px-5 py-3 w-30 tracking-wider">Chance</th>
                        <th className="px-5 py-3"></th>
                      </tr>
                    </thead>

                    {/* Outcome rows */}
                    <tbody className="divide-y divide-[#1e1e1e]">
                      {visibleOutcomes.map((outcome, idx) => {
                        const price = outcome.lastPrice || outcome.share_price || 5000;
                        const percentage = Math.round(price / 100);
                        const yesCents = percentage;
                        const noCents = 100 - percentage;
                        return (
                          <tr
                            key={outcome.id ?? idx}
                            className="transition-colors"
                          >
                            {/* Avatar + Name */}
                            <td className="px-5 py-3.5">
                              <div className="flex items-center gap-4">
                                {/* Photo or letter avatar */}
                                {outcome.imageUrl ? (
                                  <div className="w-10 h-10 rounded-lg overflow-hidden flex-shrink-0 relative">
                                    <Image
                                      src={outcome.imageUrl}
                                      alt={outcome.label}
                                      fill
                                      className="object-cover"
                                    />
                                  </div>
                                ) : (
                                  <div className="w-10 h-10 rounded-lg bg-[#262626] flex items-center justify-center flex-shrink-0">
                                    <span className="text-white text-sm font-bold">
                                      {outcome.label.charAt(0).toUpperCase()}
                                    </span>
                                  </div>
                                )}

                                {/* Name + Subtitle */}
                                <div className="flex flex-col max-w-[150px] tracking-wider ">
                                  <p className="text-white text-base font-normal truncate ">{outcome.label}</p>
                                  {outcome.subtitle && (
                                    <p className="text-[#909090] text-xs truncate">{outcome.subtitle}</p>
                                  )}
                                </div>
                              </div>
                            </td>

                            {/* Percentage */}
                            <td className="px-5 py-3.5 text-center">
                              <span className="text-white text-xl tracking-wider font-normal font-sora">
                                {percentage}%
                              </span>
                            </td>

                            {/* YES / NO inline buttons */}
                            <td className="px-5 py-3.5">
                              <div className="flex gap-2 justify-end">
                                <button
                                  onClick={() => {
                                    setSelectedOutcomeId(outcome.id ?? idx);
                                    setSelectedTokenType('yes');
                                    tradingPanelRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
                                  }}
                                  className={`w-24 py-4 rounded-md transition-all text-xs font-bold min-w-[60px] text-center ${
                                    selectedOutcomeId === (outcome.id ?? idx) && selectedTokenType === 'yes'
                                      ? 'bg-[#5CDB2A] text-white'
                                      : 'bg-[#5EDD2C14] text-[#5CDB2A]'
                                  }`}
                                >
                                  Yes {yesCents}&cent;
                                </button>
                                <button
                                  onClick={() => {
                                    setSelectedOutcomeId(outcome.id ?? idx);
                                    setSelectedTokenType('no');
                                    tradingPanelRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
                                  }}
                                  className={`w-24 py-4 rounded-md transition-all text-xs font-bold min-w-[60px] text-center ${
                                    selectedOutcomeId === (outcome.id ?? idx) && selectedTokenType === 'no'
                                      ? 'bg-[#ed4228] text-white'
                                      : 'bg-[#ED422814] text-[#ED4228]'
                                  }`}
                                >
                                  No {noCents}&cent;
                                </button>
                              </div>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>

                  {/* Show more / less */}
                  {market.outcomes.length > 5 && (
                    <div className="border-t border-[#262626] px-5 py-3">
                      <button
                        onClick={() => setShowAllOutcomes(!showAllOutcomes)}
                        className="text-sm text-blue-400 hover:text-blue-300 transition-colors font-medium"
                      >
                        {showAllOutcomes ? 'Show Less' : `Show All ${market.outcomes.length} Outcomes`}
                      </button>
                    </div>
                  )}
                </div>
              );
            })()}

            {/* Collapsible Sections */}
            <div className="space-y-2 mt-6">
              {/* Order Book */}
              <MarketOrderBookSection
                marketId={market.id}
                outcomes={market.outcomes}
                quoteDecimals={market.quoteDecimals}
              />

              {/* Rules & Timeline */}
              <MarketRulesSection market={market} />
            </div>

            {/* Comments Section */}
            <div className='lg:block hidden'>
            <MarketComments marketId={market.id} />
            </div>
          </div>

          {/* Right Column - Trading Panel */}
          <div className="space-y-4" ref={tradingPanelRef}>
            {/* Trading Panel or Redeem Panel based on market status */}
            {(() => {
              const marketStatus = typeof market.status === 'string' ? parseInt(market.status) : (market.status || 0);
              const isExpired = market.end_date && new Date(market.end_date) < new Date();

              // Active (0) and not expired - show trading panel
              if (marketStatus === 0 && !isExpired) {
                return <MarketTradingPanel market={market} selectedOutcomeId={selectedOutcomeId} selectedTokenType={selectedTokenType} onTokenTypeChange={setSelectedTokenType} />;
              }

              // Active but expired (end_date passed, status not updated yet)
              if (marketStatus === 0 && isExpired) {
                return (
                  <div className="bg-[#141414] rounded-xl p-5 border border-gray-500/20">
                    <div className="p-4 bg-gray-500/10 border border-gray-500/30 rounded-lg">
                      <h3 className="font-semibold text-gray-300 mb-2">Market Ended</h3>
                      <p className="text-sm text-gray-400">This market has ended and is awaiting resolution. Trading is no longer available.</p>
                    </div>
                  </div>
                );
              }

              // Finalized (3) - show redeem panel
              if (marketStatus === 3) {
                return <RedeemPanel market={market} />;
              }

              // Resolving (1), Disputed (2), Invalid (4) - show status banner
              if (marketStatus === 1) {
                return (
                  <div className="bg-[#141414] rounded-xl p-5 border border-yellow-500/20">
                    <div className="p-4 bg-yellow-500/10 border border-yellow-500/30 rounded-lg">
                      <h3 className="font-semibold text-yellow-400 mb-2">Pending Resolution</h3>
                      <p className="text-sm text-yellow-300/80">This market is awaiting resolution. Trading is disabled during the challenge period.</p>
                    </div>
                  </div>
                );
              }

              if (marketStatus === 2) {
                return (
                  <div className="bg-[#141414] rounded-xl p-5 border border-orange-500/20">
                    <div className="p-4 bg-orange-500/10 border border-orange-500/30 rounded-lg">
                      <h3 className="font-semibold text-orange-400 mb-2">Resolution Disputed</h3>
                      <p className="text-sm text-orange-300/80">The proposed resolution has been challenged. Trading is disabled until the dispute is resolved.</p>
                    </div>
                  </div>
                );
              }

              // Invalid (4) or any other non-active status
              return (
                <div className="bg-[#141414] rounded-xl p-5 border border-red-500/20">
                  <div className="p-4 bg-red-500/10 border border-red-500/30 rounded-lg">
                    <h3 className="font-semibold text-red-400 mb-2">Market Invalid</h3>
                    <p className="text-sm text-red-300/80">This market has been marked as invalid. Trading is disabled.</p>
                  </div>
                </div>
              );
            })()}

            {/* User Positions */}
            <MarketPositions
              marketId={market.id}
              outcomes={market.outcomes}
              marketStatus={typeof market.status === 'string' ? parseInt(market.status) : (market.status || 0)}
              marketEndDate={market.end_date}
              quoteDecimals={market.quoteDecimals}
              quoteSymbol={market.quoteSymbol}
            />

            {/* User Orders */}
            <MarketUserOrders marketId={market.id} market={market} />

            {/* Share Minting Panel - Only visible to specific wallet */}
            {canSeeShareMintingPanel && (
              <ShareMintingPanel market={market} outcomeId={0} />
            )}

            {/* Recommended Markets */}
            <RecommendedMarkets />

            {/* Comments Section */}
            <div className='block lg:hidden'>
            <MarketComments marketId={market.id} />
            </div>

          </div>
        </div>
      </Layout>

      {/* <div className='fixed right-0 top-1/2 -translate-y-1/2 z-50 cursor-pointer'>
        <div className=' text-white h-10 bg-black border border-[#262626] rounded-l-full px-4 flex items-center justify-center'>
          Mint
        </div>
      </div> */}
    </>
  );
}
