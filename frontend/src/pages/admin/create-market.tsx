import { useState } from 'react';
import { useRouter } from 'next/router';
import { AdminLayout } from '@/components/AdminLayout';
import { useWallet } from '@solana/wallet-adapter-react';
import { useSpaceProgram } from '@/hooks/useSpaceProgram';
import {
  QUOTE_TOKENS,
  QuoteTokenSymbol,
  humanToLamports,
  displayQuoteSymbol,
} from '@/utils/solana';
import { ImageUpload } from '@/components/ImageUpload';
import { isAdminWallet } from '@/utils/admin';

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001';
const TOKEN_STORAGE_KEY = 'space_auth_token';

function authHeaders(): Record<string, string> {
  const token =
    typeof window !== 'undefined' ? window.localStorage.getItem(TOKEN_STORAGE_KEY) : null;
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (token) headers['Authorization'] = `Bearer ${token}`;
  return headers;
}

const categories = [
  { value: 0, label: 'Crypto' },
  { value: 1, label: 'Politics' },
  { value: 2, label: 'Sports' },
  { value: 3, label: 'Technology' },
  { value: 4, label: 'Economics' },
  { value: 5, label: 'Culture' },
  { value: 6, label: 'Other' },
];

export default function CreateMarket() {
  const router = useRouter();
  const { connected, publicKey } = useWallet();
  const { createMarket, isReady } = useSpaceProgram();
  
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  
  const [formData, setFormData] = useState({
    title: '',
    description: '',
    imageUrl: null as string | null,
    category: 0,
    endDate: '',
    outcomes: [
      { label: 'Yes', imageUrl: null as string | null, subtitle: '' },
      { label: 'No', imageUrl: null as string | null, subtitle: '' },
    ],
    initialCollateral: 1000, // Minimum 1000 of the chosen quote token
    resolutionType: 1, // 0 = Deterministic (TWAP for crypto), 1 = Oracle (default)
    quoteToken: 'USDC' as QuoteTokenSymbol,
    autoSeed: false, // When true, backend keeper creates + seeds the orderbook
  });

  const activeQuote = QUOTE_TOKENS[formData.quoteToken];

  // Check if user is admin (in production, verify against on-chain admin list)
  const isAdmin = isAdminWallet(connected, publicKey);


  const handleAddOutcome = () => {
    if (formData.outcomes.length < 10) {
      setFormData({
        ...formData,
        outcomes: [...formData.outcomes, { label: '', imageUrl: null, subtitle: '' }],
      });
    }
  };

  const handleRemoveOutcome = (index: number) => {
    if (formData.outcomes.length > 2) {
      const newOutcomes = formData.outcomes.filter((_, i) => i !== index);
      setFormData({
        ...formData,
        outcomes: newOutcomes,
      });
    }
  };

  const handleOutcomeChange = (index: number, field: 'label' | 'imageUrl' | 'subtitle', value: string | null) => {
    const newOutcomes = [...formData.outcomes];
    newOutcomes[index] = { ...newOutcomes[index], [field]: value };
    setFormData({
      ...formData,
      outcomes: newOutcomes,
    });
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setSuccess(null);

    // Validation
    if (!formData.title.trim()) {
      setError('Title is required');
      return;
    }
    if (!formData.description.trim()) {
      setError('Description is required');
      return;
    }
    if (formData.outcomes.length < 2) {
      setError('At least 2 outcomes are required');
      return;
    }
    if (formData.outcomes.some(o => !o.label.trim())) {
      setError('All outcomes must have a label');
      return;
    }
    if (!formData.endDate) {
      setError('End date is required');
      return;
    }
    if (new Date(formData.endDate) <= new Date()) {
      setError('End date must be in the future');
      return;
    }
    if (formData.initialCollateral < activeQuote.minInitialCollateralHuman) {
      setError(
        `Minimum initial collateral is ${activeQuote.minInitialCollateralHuman} ${displayQuoteSymbol(activeQuote.symbol)}`,
      );
      return;
    }

    if (!formData.autoSeed && (!connected || !isReady)) {
      setError('Please connect your wallet');
      return;
    }

    setLoading(true);

    // Branch: keeper-driven auto-seed flow hits the backend directly.
    if (formData.autoSeed) {
      try {
        const res = await fetch(`${API_URL}/api/auto-market/create-seeded`, {
          method: 'POST',
          headers: authHeaders(),
          body: JSON.stringify({
            title: formData.title,
            description: formData.description,
            category: formData.category,
            endDate: Math.floor(new Date(formData.endDate).getTime() / 1000),
            outcomes: formData.outcomes.filter(o => o.label.trim()).map(o => o.label),
            resolutionType: formData.resolutionType,
            initialCollateral: formData.initialCollateral,
            quoteToken: formData.quoteToken,
          }),
        });
        const json = await res.json();
        if (!res.ok) throw new Error(json?.error?.message || `HTTP ${res.status}`);
        const { marketPDA } = json.data || {};
        setSuccess(`Market created + seeded! Market ID: ${marketPDA}`);
        setTimeout(() => {
          if (marketPDA) router.push(`/markets/${marketPDA}`);
        }, 2000);
      } catch (err: any) {
        setError(err.message || 'Failed to create seeded market');
        console.error('Error creating seeded market:', err);
      } finally {
        setLoading(false);
      }
      return;
    }

    try {
      // Send only labels to smart contract (on-chain doesn't store images)
      const result = await createMarket({
        title: formData.title,
        description: formData.description,
        category: formData.category,
        endDate: new Date(formData.endDate),
        outcomes: formData.outcomes.filter(o => o.label.trim()).map(o => o.label),
        initialCollateral: formData.initialCollateral,
        resolutionType: formData.resolutionType,
        quoteMint: activeQuote.mint,
        quoteDecimals: activeQuote.decimals,
      });

      // Store market in backend database
      try {
        const backendUrl = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001';
        // Get marketId from the result or generate it (should match what was used in createMarket)
        // The marketId is generated in useSpaceProgram.ts as Math.floor(Date.now() / 1000)
        // We'll need to pass it back or regenerate it here
        const marketId = Math.floor(Date.now() / 1000).toString();
        
        const response = await fetch(`${backendUrl}/api/v1/markets`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            marketAddress: result.market,
            marketId: marketId,
            creator: publicKey?.toString() || '',
            title: formData.title,
            description: formData.description,
            imageUrl: formData.imageUrl, // Include image URL
            category: formData.category,
            endDate: new Date(formData.endDate).toISOString(),
            outcomes: formData.outcomes.filter(o => o.label.trim()).map(o => ({
              label: o.label,
              imageUrl: o.imageUrl || null,
              subtitle: o.subtitle || null,
            })),
            initialCollateral: humanToLamports(
              formData.initialCollateral,
              activeQuote.decimals,
            ).toString(), // Base-unit lamports for the chosen quote token
            quoteMint: activeQuote.mint.toString(),
            quoteSymbol: activeQuote.symbol,
            quoteDecimals: activeQuote.decimals,
          }),
        });
        
        if (!response.ok) {
          throw new Error(`Backend error: ${response.statusText}`);
        }
        
        console.log('Market stored in backend successfully');
      } catch (backendError) {
        console.warn('Failed to store market in backend:', backendError);
        // Don't fail the whole operation if backend storage fails
      }

      setSuccess(`Market created successfully! Market ID: ${result.market}`);
      
      // Redirect to market page after 2 seconds
      setTimeout(() => {
        router.push(`/markets/${result.market}`);
      }, 2000);
    } catch (err: any) {
      setError(err.message || 'Failed to create market');
      console.error('Error creating market:', err);
    } finally {
      setLoading(false);
    }
  };

  // Auth is handled by AdminLayout
  if (!isAdmin || !connected) {
    return <AdminLayout title="Create Market" description="Create a new prediction market" />;
  }

  return (
    <AdminLayout title="Create Market" description="Create a new prediction market with initial liquidity">
      <div className="max-w-4xl">
        <form onSubmit={handleSubmit} className="space-y-6">
          {/* Auto-seed toggle */}
          <div
            className={`rounded-2xl p-5 border transition-colors ${
              formData.autoSeed
                ? 'bg-emerald-500/10 border-emerald-500/40'
                : 'bg-[#0a0a0a] border-[#1a1a1a] hover:border-[#262626]'
            }`}
          >
            <label className="flex items-start gap-3 cursor-pointer">
              <input
                type="checkbox"
                checked={formData.autoSeed}
                onChange={(e) =>
                  setFormData({ ...formData, autoSeed: e.target.checked })
                }
                className="mt-1 h-4 w-4 accent-emerald-400 cursor-pointer"
              />
              <div className="flex-1">
                <div className="font-semibold text-white">
                  Auto-seed orderbook with keeper wallet
                </div>
                <p className="text-xs text-[#a3a3a3] mt-1">
                  Backend keeper creates the market and seeds YES/NO orderbook in one call.
                  Market/outcome images and subtitles are ignored in this mode — add them later from the market edit screen.
                </p>
              </div>
            </label>
          </div>

          {/* Image and Title Row */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            {/* Market Image */}
            <div className="bg-[#0a0a0a] rounded-2xl p-6 border border-[#1a1a1a] hover:border-[#262626] transition-colors">
              <label className="block text-sm font-semibold text-white mb-4">
                Market Image
              </label>
              <ImageUpload
                value={formData.imageUrl}
                onChange={(url) => setFormData({ ...formData, imageUrl: url })}
              />
              <p className="mt-3 text-xs text-[#525252]">
                Optional. Will be cropped to 1:1 ratio.
              </p>
            </div>

            {/* Title */}
            <div className="md:col-span-2 bg-[#0a0a0a] rounded-2xl p-6 border border-[#1a1a1a] hover:border-[#262626] transition-colors">
              <label className="block text-sm font-semibold text-white mb-3">
                Market Title <span className="text-red-400">*</span>
              </label>
              <input
                type="text"
                value={formData.title}
                onChange={(e) => setFormData({ ...formData, title: e.target.value })}
                placeholder="e.g., Will Bitcoin hit $150K this year?"
                className="w-full px-4 py-3.5 bg-[#111111] border border-[#262626] rounded-xl text-white placeholder-[#525252] focus:outline-none focus:ring-2 focus:ring-white/20 focus:border-transparent transition-all"
                maxLength={200}
                required
              />
              <div className="mt-2 flex justify-between text-xs text-[#525252]">
                <span>Be specific and clear</span>
                <span>{formData.title.length}/200</span>
              </div>
            </div>
          </div>

          {/* Description */}
          <div className="bg-[#0a0a0a] rounded-2xl p-6 border border-[#1a1a1a] hover:border-[#262626] transition-colors">
            <label className="block text-sm font-semibold text-white mb-3">
              Description <span className="text-red-400">*</span>
            </label>
            <textarea
              value={formData.description}
              onChange={(e) => setFormData({ ...formData, description: e.target.value })}
              placeholder="Describe the market and resolution criteria..."
              rows={4}
              className="w-full px-4 py-3.5 bg-[#111111] border border-[#262626] rounded-xl text-white placeholder-[#525252] focus:outline-none focus:ring-2 focus:ring-white/20 focus:border-transparent resize-none transition-all"
              maxLength={1000}
              required
            />
            <div className="mt-2 flex justify-between text-xs text-[#525252]">
              <span>Include resolution criteria</span>
              <span>{formData.description.length}/1000</span>
            </div>
          </div>

          {/* Category and End Date */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div className="bg-[#0a0a0a] rounded-2xl p-6 border border-[#1a1a1a] hover:border-[#262626] transition-colors">
              <label className="block text-sm font-semibold text-white mb-3">
                Category <span className="text-red-400">*</span>
              </label>
              <select
                value={formData.category}
                onChange={(e) => setFormData({ ...formData, category: parseInt(e.target.value) })}
                className="w-full px-4 py-3.5 bg-[#111111] border border-[#262626] rounded-xl text-white focus:outline-none focus:ring-2 focus:ring-white/20 focus:border-transparent appearance-none cursor-pointer transition-all"
                style={{ backgroundImage: `url("data:image/svg+xml,%3csvg xmlns='http://www.w3.org/2000/svg' fill='none' viewBox='0 0 20 20'%3e%3cpath stroke='%236b7280' stroke-linecap='round' stroke-linejoin='round' stroke-width='1.5' d='M6 8l4 4 4-4'/%3e%3c/svg%3e")`, backgroundPosition: 'right 0.75rem center', backgroundRepeat: 'no-repeat', backgroundSize: '1.5em 1.5em', paddingRight: '2.5rem' }}
              >
                {categories.map((cat) => (
                  <option key={cat.value} value={cat.value} className="bg-[#111111]">
                    {cat.label}
                  </option>
                ))}
              </select>
            </div>

            <div className="bg-[#0a0a0a] rounded-2xl p-6 border border-[#1a1a1a] hover:border-[#262626] transition-colors">
              <label className="block text-sm font-semibold text-white mb-3">
                End Date <span className="text-red-400">*</span>
              </label>
              <input
                type="datetime-local"
                value={formData.endDate}
                onChange={(e) => setFormData({ ...formData, endDate: e.target.value })}
                className="w-full px-4 py-3.5 bg-[#111111] border border-[#262626] rounded-xl text-white focus:outline-none focus:ring-2 focus:ring-white/20 focus:border-transparent transition-all [color-scheme:dark]"
                required
              />
            </div>
          </div>

          {/* Resolution Type */}
          <div className="bg-[#0a0a0a] rounded-2xl p-6 border border-[#1a1a1a] hover:border-[#262626] transition-colors">
            <label className="block text-sm font-semibold text-white mb-3">
              Resolution Type <span className="text-red-400">*</span>
            </label>
            <div className="grid grid-cols-2 gap-4">
              <button
                type="button"
                onClick={() => setFormData({ ...formData, resolutionType: 0 })}
                className={`p-4 rounded-xl border-2 text-left transition-all ${
                  formData.resolutionType === 0
                    ? 'border-white bg-white/5'
                    : 'border-[#262626] hover:border-[#404040]'
                }`}
              >
                <div className="flex items-center gap-3 mb-2">
                  <span className="text-lg">📊</span>
                  <span className="font-semibold text-white">Deterministic (TWAP)</span>
                </div>
                <p className="text-xs text-[#737373]">
                  Uses 15-minute Time-Weighted Average Price from Pyth/Switchboard oracles
                </p>
              </button>
              <button
                type="button"
                onClick={() => setFormData({ ...formData, resolutionType: 1 })}
                className={`p-4 rounded-xl border-2 text-left transition-all ${
                  formData.resolutionType === 1
                    ? 'border-white bg-white/5'
                    : 'border-[#262626] hover:border-[#404040]'
                }`}
              >
                <div className="flex items-center gap-3 mb-2">
                  <span className="text-lg">🔮</span>
                  <span className="font-semibold text-white">Oracle / Manual</span>
                </div>
                <p className="text-xs text-[#737373]">
                  Uses 2-of-3 operator multisig with 24-48h challenge period
                </p>
              </button>
            </div>
          </div>

          {/* Outcomes */}
          <div className="bg-[#0a0a0a] rounded-2xl p-6 border border-[#1a1a1a] hover:border-[#262626] transition-colors">
            <div className="flex items-center justify-between mb-4">
              <label className="block text-sm font-semibold text-white">
                Outcomes <span className="text-red-400">*</span>
                <span className="ml-2 text-xs font-normal text-[#525252]">(2-10)</span>
              </label>
              {formData.outcomes.length < 10 && (
                <button
                  type="button"
                  onClick={handleAddOutcome}
                  className="px-4 py-2 bg-white/10 hover:bg-white/20 text-white text-sm font-medium rounded-lg transition-colors flex items-center gap-2"
                >
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                  </svg>
                  Add Outcome
                </button>
              )}
            </div>
            <div className="space-y-4">
              {formData.outcomes.map((outcome, index) => (
                <div key={index} className="flex gap-3 p-3 bg-[#111111] border border-[#262626] rounded-xl">
                  {/* Outcome Image */}
                  <div className="w-16 h-16 shrink-0">
                    <ImageUpload
                      value={outcome.imageUrl}
                      onChange={(url) => handleOutcomeChange(index, 'imageUrl', url)}
                      compact
                      className="w-full h-full"
                    />
                  </div>
                  {/* Label + Subtitle */}
                  <div className="flex-1 flex flex-col gap-2">
                    <input
                      type="text"
                      value={outcome.label}
                      onChange={(e) => handleOutcomeChange(index, 'label', e.target.value)}
                      placeholder={`Outcome ${index + 1} label`}
                      className="w-full px-3 py-2 bg-[#0a0a0a] border border-[#262626] rounded-lg text-white text-sm placeholder-[#525252] focus:outline-none focus:ring-2 focus:ring-white/20 focus:border-transparent transition-all"
                      required
                    />
                    <input
                      type="text"
                      value={outcome.subtitle}
                      onChange={(e) => handleOutcomeChange(index, 'subtitle', e.target.value)}
                      placeholder="Subtitle (e.g., party, team) — optional"
                      className="w-full px-3 py-2 bg-[#0a0a0a] border border-[#262626] rounded-lg text-[#a3a3a3] text-xs placeholder-[#525252] focus:outline-none focus:ring-2 focus:ring-white/20 focus:border-transparent transition-all"
                    />
                  </div>
                  {/* Remove button */}
                  {formData.outcomes.length > 2 && (
                    <button
                      type="button"
                      onClick={() => handleRemoveOutcome(index)}
                      className="self-center p-2 bg-red-500/10 hover:bg-red-500/20 text-red-400 rounded-lg transition-colors shrink-0"
                    >
                      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                      </svg>
                    </button>
                  )}
                </div>
              ))}
            </div>
          </div>

          {/* Quote Token */}
          <div className="bg-[#0a0a0a] rounded-2xl p-6 border border-[#1a1a1a] hover:border-[#262626] transition-colors">
            <label className="block text-sm font-semibold text-white mb-3">
              Quote Token <span className="text-red-400">*</span>
            </label>
            <div className="grid grid-cols-2 gap-3">
              {(Object.keys(QUOTE_TOKENS) as QuoteTokenSymbol[]).map((sym) => {
                const cfg = QUOTE_TOKENS[sym];
                const selected = formData.quoteToken === sym;
                return (
                  <button
                    type="button"
                    key={sym}
                    onClick={() => setFormData({ ...formData, quoteToken: sym })}
                    className={`px-4 py-3 rounded-xl border text-left transition-all ${
                      selected
                        ? 'bg-white text-black border-white'
                        : 'bg-[#111111] text-white border-[#262626] hover:border-[#404040]'
                    }`}
                  >
                    <div className="font-semibold">{displayQuoteSymbol(cfg.symbol)}</div>
                    <div className={`text-xs mt-0.5 font-mono ${selected ? 'text-black/60' : 'text-[#737373]'}`}>
                      {cfg.mint.toBase58().slice(0, 8)}…{cfg.mint.toBase58().slice(-6)}
                    </div>
                    <div className={`text-xs mt-0.5 ${selected ? 'text-black/60' : 'text-[#737373]'}`}>
                      {cfg.decimals} decimals
                    </div>
                  </button>
                );
              })}
            </div>
            <p className="mt-3 text-xs text-[#737373]">
              Your wallet must hold enough of the selected token to seed the market. For SPC markets, run
              the faucet or mint script beforehand.
            </p>
          </div>

          {/* Initial Collateral */}
          <div className="bg-[#0a0a0a] rounded-2xl p-6 border border-[#1a1a1a] hover:border-[#262626] transition-colors">
            <label className="block text-sm font-semibold text-white mb-3">
              Initial Collateral <span className="text-red-400">*</span>
            </label>
            <div className="relative">
              <input
                type="number"
                value={formData.initialCollateral}
                onChange={(e) => setFormData({ ...formData, initialCollateral: parseFloat(e.target.value) || 0 })}
                min={activeQuote.minInitialCollateralHuman}
                step={100}
                className="w-full px-4 py-3.5 bg-[#111111] border border-[#262626] rounded-xl text-white focus:outline-none focus:ring-2 focus:ring-white/20 focus:border-transparent pr-20 transition-all"
                required
              />
              <span className="absolute right-4 top-1/2 -translate-y-1/2 text-[#525252] font-medium">
                {displayQuoteSymbol(activeQuote.symbol)}
              </span>
            </div>
            <div className="mt-3 flex items-start gap-3 p-3 bg-[#111111] rounded-xl border border-[#1a1a1a]">
              <svg className="w-5 h-5 text-[#737373] shrink-0 mt-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
              <div className="text-xs text-[#737373]">
                <p className="mb-1">
                  Minimum:{' '}
                  <span className="text-white font-medium">
                    {activeQuote.minInitialCollateralHuman} {displayQuoteSymbol(activeQuote.symbol)}
                  </span>
                </p>
                <p>This collateral goes into the shared vault and supports leveraged trading on this market.</p>
              </div>
            </div>
          </div>

          {/* Error/Success Messages */}
          {error && (
            <div className="bg-red-500/10 border border-red-500/20 rounded-xl p-4 flex items-start gap-3">
              <svg className="w-5 h-5 text-red-400 shrink-0 mt-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
              <p className="text-red-400 text-sm">{error}</p>
            </div>
          )}

          {success && (
            <div className="bg-emerald-500/10 border border-emerald-500/20 rounded-xl p-4 flex items-start gap-3">
              <svg className="w-5 h-5 text-emerald-400 shrink-0 mt-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
              <p className="text-emerald-400 text-sm">{success}</p>
            </div>
          )}

          {/* Submit Buttons */}
          <div className="flex items-center justify-end gap-4 pt-4">
            <button
              type="button"
              onClick={() => router.back()}
              className="px-6 py-3 bg-[#171717] hover:bg-[#262626] text-white font-medium rounded-xl transition-colors"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={loading || !isReady}
              className="px-8 py-3 bg-white hover:bg-neutral-200 text-black font-semibold rounded-xl transition-all disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
            >
              {loading ? (
                <>
                  <svg className="animate-spin h-4 w-4" fill="none" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                  </svg>
                  Creating...
                </>
              ) : (
                <>
                  Create Market
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 7l5 5m0 0l-5 5m5-5H6" />
                  </svg>
                </>
              )}
            </button>
          </div>
        </form>
      </div>
    </AdminLayout>
  );
}
