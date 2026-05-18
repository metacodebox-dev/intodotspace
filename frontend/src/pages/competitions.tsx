import Head from 'next/head';
import { Layout } from '@/components/Layout';
import { useState, useEffect } from 'react';
import {
  CompetitionsBanner,
  CampaignCard,
  CampaignModal,
  CompetitionLeaderboard,
  apiToCampaign,
  Campaign,
} from '@/components/competitions';

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001';

export default function Competitions() {
  const [activeTab, setActiveTab] = useState<'active' | 'ended' | 'leaderboard'>('active');
  const [selectedCampaign, setSelectedCampaign] = useState<Campaign | null>(null);
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    async function fetchCompetitions() {
      try {
        const res = await fetch(`${API_URL}/api/competitions`);
        const data = await res.json();
        if (data.success && Array.isArray(data.data)) {
          setCampaigns(data.data.map(apiToCampaign));
        }
      } catch (err) {
        console.error('[Competitions] Failed to fetch:', err);
      } finally {
        setIsLoading(false);
      }
    }
    fetchCompetitions();
  }, []);

  const filtered = campaigns.filter((c) =>
    activeTab === 'active'
      ? c.status === 'live' || c.status === 'upcoming'
      : c.status === 'ended'
  );

  return (
    <>
      <Head>
        <title>Competitions - Space</title>
        <meta
          name="description"
          content="Join trading campaigns, earn points, and compete for rewards."
        />
      </Head>

      <Layout>
        <div className="w-full max-w-5xl mx-auto px-4 py-6 space-y-8">
          <CompetitionsBanner />

          {/* Trading Campaigns Header */}
          <div className="flex items-center justify-between flex-wrap gap-4">
            <h3 className="text-xl font-bold text-white">Trading Campaigns</h3>
            <div className="flex items-center gap-2">
              <button
                onClick={() => setActiveTab('active')}
                className={`px-6 py-2 rounded-lg text-sm font-medium transition-colors border ${
                  activeTab === 'active'
                    ? 'bg-white text-black border-white'
                    : 'bg-transparent text-white border-[#404040] hover:border-[#555]'
                }`}
              >
                Active
              </button>
              <button
                onClick={() => setActiveTab('ended')}
                className={`px-6 py-2 rounded-lg text-sm font-medium transition-colors border ${
                  activeTab === 'ended'
                    ? 'bg-white text-black border-white'
                    : 'bg-transparent text-white border-[#404040] hover:border-[#555]'
                }`}
              >
                Ended
              </button>
              <button
                onClick={() => setActiveTab('leaderboard')}
                className={`px-6 py-2 rounded-lg text-sm font-medium transition-colors border ${
                  activeTab === 'leaderboard'
                    ? 'bg-white text-black border-white'
                    : 'bg-transparent text-white border-[#404040] hover:border-[#555]'
                }`}
              >
                Leaderboard
              </button>
            </div>
          </div>

          {/* Tab Content */}
          {activeTab === 'leaderboard' ? (
            !isLoading && campaigns.length > 0 ? (
              <CompetitionLeaderboard campaigns={campaigns} />
            ) : isLoading ? (
              <div className="rounded-xl border border-[#262626] overflow-hidden">
                <div className="divide-y divide-[#262626]">
                  {[1, 2, 3, 4, 5].map((i) => (
                    <div key={i} className="px-4 py-3 h-14 animate-pulse" />
                  ))}
                </div>
              </div>
            ) : (
              <div className="rounded-xl border border-[#262626] bg-[#141414] p-10 text-center">
                <p className="text-space-gray-400 text-sm">No competitions available yet.</p>
              </div>
            )
          ) : (
            <div className="space-y-4">
              {isLoading ? (
                <div className="space-y-4">
                  {[1, 2, 3].map((i) => (
                    <div
                      key={i}
                      className="rounded-xl border border-[#262626] bg-[#141414] p-5 h-20 animate-pulse"
                    />
                  ))}
                </div>
              ) : filtered.length > 0 ? (
                filtered.map((campaign) => (
                  <CampaignCard
                    key={campaign.id}
                    campaign={campaign}
                    onClick={() => setSelectedCampaign(campaign)}
                  />
                ))
              ) : (
                <div className="rounded-xl border border-[#262626] bg-[#141414] p-10 text-center">
                  <p className="text-space-gray-400 text-sm">
                    No {activeTab} campaigns at the moment.
                  </p>
                </div>
              )}
            </div>
          )}
        </div>

        {selectedCampaign && (
          <CampaignModal
            campaign={selectedCampaign}
            onClose={() => setSelectedCampaign(null)}
          />
        )}
      </Layout>
    </>
  );
}
