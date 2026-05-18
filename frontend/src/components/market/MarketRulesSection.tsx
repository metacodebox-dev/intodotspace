import { useState } from 'react';
import { Market } from '@/types/market';

interface MarketRulesSectionProps {
  market: Market;
}

export function MarketRulesSection({ market }: MarketRulesSectionProps) {
  const [rulesOpen, setRulesOpen] = useState(true);
  const [timelineOpen, setTimelineOpen] = useState(false);

  return (
    <div className="bg-[#141414] rounded-xl">
      {/* Rules & Resolution */}
      <div>
        <button
          onClick={() => setRulesOpen(!rulesOpen)}
          className="w-full px-5 py-4 flex items-center justify-between"
        >
          <div className="flex items-center gap-2">
            <span className="text-white font-semibold">Rules & Resolution</span>
          </div>
          <svg 
            className={`w-5 h-5 text-gray-400 transition-transform ${rulesOpen ? 'rotate-180' : ''}`} 
            fill="none" 
            viewBox="0 0 24 24" 
            stroke="currentColor"
          >
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
          </svg>
        </button>
        {rulesOpen && (
          <div className="px-5 pb-4">
            <p className="text-sm text-gray-400 leading-relaxed">
              {market.description || 'Lorem Ipsum is simply dummy text of the printing and typesetting industry. Lorem Ipsum has been the industry\'s standard dummy text ever since the 1500s, when an unknown printer took a galley of type and scrambled it to make a type specimen book. It has survived not only five centuries, but also the leap into electronic typesetting, remaining essentially unchanged.'}
            </p>
          </div>
        )}
      </div>

      <div className='w-full border-t border-[#262626]'/>

      {/* Timeline & Payout */}
      <div>
        <button
          onClick={() => setTimelineOpen(!timelineOpen)}
          className="w-full px-5 py-4 flex items-center justify-between"
        >
          <div className="flex items-center gap-2">
            <span className="text-white font-semibold">Timeline & Payout</span>
          </div>
          <svg 
            className={`w-5 h-5 text-gray-400 transition-transform ${timelineOpen ? 'rotate-180' : ''}`} 
            fill="none" 
            viewBox="0 0 24 24" 
            stroke="currentColor"
          >
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
          </svg>
        </button>
        {timelineOpen && (
          <div className="px-5 pb-4">
            <div className="space-y-3">
              <div className="flex items-center justify-between text-sm">
                <span className="text-gray-400">Created</span>
                <span className="text-white">
                  {market.created_at ? new Date(market.created_at).toLocaleDateString() : 'N/A'}
                </span>
              </div>
              <div className="flex items-center justify-between text-sm">
                <span className="text-gray-400">Ends</span>
                <span className="text-white">
                  {market.end_date ? new Date(market.end_date).toLocaleDateString() : 'N/A'}
                </span>
              </div>
              <div className="flex items-center justify-between text-sm">
                <span className="text-gray-400">Resolution Source</span>
                <span className="text-white">{market.resolution_source || 'Official Announcement'}</span>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
