import { useState } from 'react';
import { AdminLayout } from '@/components/AdminLayout';
import { useWallet } from '@solana/wallet-adapter-react';
import { useSpaceProgram } from '@/hooks/useSpaceProgram';
import { isAdminWallet } from '@/utils/admin';

export default function InitializeConfig() {
  const { connected, publicKey } = useWallet();
  const { initializeConfig, isReady, loading } = useSpaceProgram();
  
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  
  // Default values from the program constants
  const [formData, setFormData] = useState({
    maxGlobalOi: '1000000000000000', // 1,000,000,000 USDC (1 billion)
    protocolFeeBps: 10, // 0.1%
    creatorFeeBps: 20, // 0.2%
    insuranceFeeBps: 5, // 0.05%
  });

  const isAdmin = isAdminWallet(connected, publicKey);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setSuccess(null);

    if (!connected || !publicKey) {
      setError('Please connect your wallet');
      return;
    }

    if (!isReady) {
      setError('Program not ready. Please wait...');
      return;
    }

    try {
      const result = await initializeConfig(
        formData.maxGlobalOi,
        formData.protocolFeeBps,
        formData.creatorFeeBps,
        formData.insuranceFeeBps
      );

      setSuccess(`Config initialized successfully! Transaction: ${result.transaction}`);
    } catch (err: any) {
      console.error('Error initializing config:', err);
      setError(err.message || 'Failed to initialize config');
    }
  };

  // Auth is handled by AdminLayout
  if (!isAdmin) {
    return <AdminLayout title="Initialize Config" description="Set up protocol configuration" />;
  }

  return (
    <AdminLayout title="Initialize Config" description="One-time protocol configuration setup">
      <div className="max-w-2xl">
        {/* Header Card */}
        <div className="bg-gradient-to-r from-[#0a0a0a] to-[#111111] rounded-2xl p-6 border border-[#1a1a1a] mb-6">
          <div className="flex items-center gap-4">
            <div className="w-12 h-12 rounded-xl bg-white/5 border border-[#262626] flex items-center justify-center">
              <span className="text-2xl">⚙️</span>
            </div>
            <div>
              <h2 className="text-lg font-semibold text-white">Protocol Configuration</h2>
              <p className="text-sm text-[#737373]">Initialize the core protocol settings</p>
            </div>
          </div>
        </div>

        <div className="bg-[#0a0a0a] rounded-2xl border border-[#1a1a1a] overflow-hidden">
          {/* Alerts */}
          <div className="p-6 space-y-4">
            {!connected && (
              <div className="bg-amber-500/10 border border-amber-500/20 rounded-xl p-4 flex items-start gap-3">
                <svg className="w-5 h-5 text-amber-400 shrink-0 mt-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                </svg>
                <p className="text-amber-400 text-sm">Please connect your wallet to initialize the config.</p>
              </div>
            )}

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
                <p className="text-emerald-400 text-sm whitespace-pre-wrap">{success}</p>
              </div>
            )}
          </div>

          {/* Form */}
          <form onSubmit={handleSubmit} className="p-6 pt-0 space-y-6">
            {/* Max Global OI */}
            <div>
              <label className="block text-sm font-medium text-white mb-2">
                Max Global Open Interest
                <span className="text-[#525252] font-normal ml-2">(in lamports)</span>
              </label>
              <input
                type="text"
                value={formData.maxGlobalOi}
                onChange={(e) => setFormData({ ...formData, maxGlobalOi: e.target.value })}
                className="w-full px-4 py-3.5 bg-[#111111] border border-[#262626] rounded-xl text-white font-mono text-sm focus:outline-none focus:ring-2 focus:ring-white/20 focus:border-transparent transition-all"
                placeholder="1000000000000000"
                required
              />
              <p className="mt-2 text-xs text-[#525252]">
                Example: 1000000000000000 = 1,000,000,000 USDC
              </p>
            </div>

            {/* Fee Grid */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div className="bg-[#111111] rounded-xl p-4 border border-[#1a1a1a]">
                <label className="block text-xs font-medium text-[#737373] mb-2 uppercase tracking-wider">
                  Protocol Fee
                </label>
                <div className="flex items-baseline gap-2">
                  <input
                    type="number"
                    value={formData.protocolFeeBps}
                    onChange={(e) => setFormData({ ...formData, protocolFeeBps: parseInt(e.target.value) || 0 })}
                    className="w-20 px-3 py-2 bg-[#0a0a0a] border border-[#262626] rounded-lg text-white text-lg font-semibold focus:outline-none focus:ring-2 focus:ring-white/20 focus:border-transparent transition-all"
                    min="0"
                    max="10000"
                    required
                  />
                  <span className="text-[#525252] text-sm">bps</span>
                </div>
                <p className="mt-2 text-xs text-[#525252]">
                  = {(formData.protocolFeeBps / 100).toFixed(2)}%
                </p>
              </div>

              <div className="bg-[#111111] rounded-xl p-4 border border-[#1a1a1a]">
                <label className="block text-xs font-medium text-[#737373] mb-2 uppercase tracking-wider">
                  Creator Fee
                </label>
                <div className="flex items-baseline gap-2">
                  <input
                    type="number"
                    value={formData.creatorFeeBps}
                    onChange={(e) => setFormData({ ...formData, creatorFeeBps: parseInt(e.target.value) || 0 })}
                    className="w-20 px-3 py-2 bg-[#0a0a0a] border border-[#262626] rounded-lg text-white text-lg font-semibold focus:outline-none focus:ring-2 focus:ring-white/20 focus:border-transparent transition-all"
                    min="0"
                    max="10000"
                    required
                  />
                  <span className="text-[#525252] text-sm">bps</span>
                </div>
                <p className="mt-2 text-xs text-[#525252]">
                  = {(formData.creatorFeeBps / 100).toFixed(2)}%
                </p>
              </div>

              <div className="bg-[#111111] rounded-xl p-4 border border-[#1a1a1a]">
                <label className="block text-xs font-medium text-[#737373] mb-2 uppercase tracking-wider">
                  Insurance Fee
                </label>
                <div className="flex items-baseline gap-2">
                  <input
                    type="number"
                    value={formData.insuranceFeeBps}
                    onChange={(e) => setFormData({ ...formData, insuranceFeeBps: parseInt(e.target.value) || 0 })}
                    className="w-20 px-3 py-2 bg-[#0a0a0a] border border-[#262626] rounded-lg text-white text-lg font-semibold focus:outline-none focus:ring-2 focus:ring-white/20 focus:border-transparent transition-all"
                    min="0"
                    max="10000"
                    required
                  />
                  <span className="text-[#525252] text-sm">bps</span>
                </div>
                <p className="mt-2 text-xs text-[#525252]">
                  = {(formData.insuranceFeeBps / 100).toFixed(2)}%
                </p>
              </div>
            </div>

            {/* Total Fee */}
            <div className="bg-[#111111] rounded-xl p-4 border border-[#1a1a1a]">
              <div className="flex items-center justify-between">
                <span className="text-[#737373] text-sm">Total Trading Fee</span>
                <span className="text-white text-lg font-semibold">
                  {((formData.protocolFeeBps + formData.creatorFeeBps + formData.insuranceFeeBps) / 100).toFixed(2)}%
                </span>
              </div>
              <div className="mt-3 h-2 bg-[#0a0a0a] rounded-full overflow-hidden">
                <div 
                  className="h-full bg-gradient-to-r from-white/40 to-white/60 rounded-full"
                  style={{ width: `${Math.min((formData.protocolFeeBps + formData.creatorFeeBps + formData.insuranceFeeBps) / 100, 100)}%` }}
                />
              </div>
            </div>

            {/* Warning */}
            <div className="bg-amber-500/5 border border-amber-500/20 rounded-xl p-4">
              <div className="flex items-start gap-3">
                <svg className="w-5 h-5 text-amber-400 shrink-0 mt-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                </svg>
                <div>
                  <h3 className="text-sm font-semibold text-amber-400 mb-1">Important Notes</h3>
                  <ul className="text-xs text-[#a3a3a3] space-y-1">
                    <li>• This can only be done <span className="text-white font-medium">once</span>. The config account is initialized permanently.</li>
                    <li>• You will become the admin of the protocol.</li>
                    <li>• Make sure you have enough SOL for transaction fees.</li>
                    <li>• After initialization, you can update these values using the update config function.</li>
                  </ul>
                </div>
              </div>
            </div>

            <button
              type="submit"
              disabled={!connected || !isReady || loading}
              className="w-full px-6 py-4 bg-white hover:bg-neutral-200 text-black font-semibold rounded-xl transition-all disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
            >
              {loading ? (
                <>
                  <svg className="animate-spin h-5 w-5" fill="none" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                  </svg>
                  Initializing...
                </>
              ) : (
                <>
                  Initialize Config
                  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 7l5 5m0 0l-5 5m5-5H6" />
                  </svg>
                </>
              )}
            </button>
          </form>
        </div>
      </div>
    </AdminLayout>
  );
}
