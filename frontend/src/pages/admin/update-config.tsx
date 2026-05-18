import { useState, useEffect } from 'react';
import { AdminLayout } from '@/components/AdminLayout';
import { useWallet } from '@solana/wallet-adapter-react';
import { useSpaceProgram } from '@/hooks/useSpaceProgram';
import { isAdminWallet } from '@/utils/admin';

export default function UpdateConfig() {
  const { connected, publicKey } = useWallet();
  const { updateConfig, isReady, loading, program } = useSpaceProgram();
  
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [currentFees, setCurrentFees] = useState<{
    protocolFeeBps: number | null;
    insuranceFeeBps: number | null;
  }>({ protocolFeeBps: null, insuranceFeeBps: null });
  const [loadingFees, setLoadingFees] = useState(false);
  
  const [formData, setFormData] = useState({
    protocolFeeBps: '',
    insuranceFeeBps: '',
  });

  const isAdmin = isAdminWallet(connected, publicKey);

  // Fetch current config fees
  const fetchCurrentFees = async () => {
    if (!program || !connected) return;
    
    setLoadingFees(true);
    try {
      const { getConfigPDA } = await import('@/utils/solana');
      const [configPDA] = getConfigPDA();
      const configAccount = await program.account.config.fetch(configPDA);
      
      setCurrentFees({
        protocolFeeBps: configAccount.protocolFeeBps.toNumber(),
        insuranceFeeBps: configAccount.insuranceFeeBps.toNumber(),
      });
      
      // Pre-fill form with current values
      setFormData({
        protocolFeeBps: configAccount.protocolFeeBps.toNumber().toString(),
        insuranceFeeBps: configAccount.insuranceFeeBps.toNumber().toString(),
      });
    } catch (err: any) {
      console.error('Error fetching config:', err);
      setError('Could not fetch current config. Make sure config is initialized.');
    } finally {
      setLoadingFees(false);
    }
  };

  // Fetch fees on mount
  useEffect(() => {
    if (connected && program) {
      fetchCurrentFees();
    }
  }, [connected, program]);

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
      const protocolFeeBps = formData.protocolFeeBps ? parseInt(formData.protocolFeeBps) : undefined;
      const insuranceFeeBps = formData.insuranceFeeBps ? parseInt(formData.insuranceFeeBps) : undefined;

      if (protocolFeeBps === undefined && insuranceFeeBps === undefined) {
        setError('Please provide at least one fee to update');
        return;
      }

      const result = await updateConfig(
        undefined, // maxGlobalOi - keep current
        protocolFeeBps,
        undefined, // creatorFeeBps - can't update via config (it's in market)
        insuranceFeeBps
      );

      setSuccess(`Config updated successfully! Transaction: ${result.transaction}`);
      
      // Refresh current fees
      setTimeout(() => fetchCurrentFees(), 2000);
    } catch (err: any) {
      console.error('Error updating config:', err);
      setError(err.message || 'Failed to update config');
    }
  };

  // Auth is handled by AdminLayout
  if (!isAdmin) {
    return <AdminLayout title="Update Config" description="Update protocol parameters" />;
  }

  return (
    <AdminLayout title="Update Config" description="Update protocol parameters (fees, limits)">
      <div className="max-w-2xl">
        {/* Header Card */}
        <div className="bg-gradient-to-r from-[#0a0a0a] to-[#111111] rounded-2xl p-6 border border-[#1a1a1a] mb-6">
          <div className="flex items-center gap-4">
            <div className="w-12 h-12 rounded-xl bg-white/5 border border-[#262626] flex items-center justify-center">
              <span className="text-2xl">📝</span>
            </div>
            <div>
              <h2 className="text-lg font-semibold text-white">Update Protocol Settings</h2>
              <p className="text-sm text-[#737373]">Modify fees and protocol parameters</p>
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
                <p className="text-amber-400 text-sm">Please connect your wallet to update the config.</p>
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

            {/* Current Fees Display */}
            {connected && (currentFees.protocolFeeBps !== null || currentFees.insuranceFeeBps !== null) && (
              <div className="bg-[#111111] rounded-xl border border-[#1a1a1a] overflow-hidden">
                <div className="px-4 py-3 border-b border-[#1a1a1a] flex items-center justify-between">
                  <h3 className="text-sm font-semibold text-white">Current Configuration</h3>
                  <button
                    onClick={fetchCurrentFees}
                    disabled={loadingFees}
                    className="text-xs text-[#737373] hover:text-white transition-colors flex items-center gap-1"
                  >
                    <svg className={`w-3 h-3 ${loadingFees ? 'animate-spin' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                    </svg>
                    {loadingFees ? 'Loading...' : 'Refresh'}
                  </button>
                </div>
                <div className="p-4 space-y-3">
                  <div className="flex items-center justify-between">
                    <span className="text-[#737373] text-sm">Protocol Fee</span>
                    <span className="text-white font-mono">
                      {currentFees.protocolFeeBps} bps <span className="text-[#525252]">({(currentFees.protocolFeeBps! / 100).toFixed(2)}%)</span>
                    </span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-[#737373] text-sm">Insurance Fee</span>
                    <span className="text-white font-mono">
                      {currentFees.insuranceFeeBps} bps <span className="text-[#525252]">({(currentFees.insuranceFeeBps! / 100).toFixed(2)}%)</span>
                    </span>
                  </div>
                  <div className="pt-3 border-t border-[#1a1a1a] flex items-center justify-between">
                    <span className="text-[#737373] text-sm">Total (incl. 20 bps creator)</span>
                    <span className="text-white font-semibold">
                      {((currentFees.protocolFeeBps! + 20 + currentFees.insuranceFeeBps!) / 100).toFixed(2)}%
                    </span>
                  </div>
                </div>
              </div>
            )}
          </div>

          {/* Form */}
          <form onSubmit={handleSubmit} className="p-6 pt-0 space-y-6">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="bg-[#111111] rounded-xl p-5 border border-[#1a1a1a]">
                <label className="block text-xs font-medium text-[#737373] mb-3 uppercase tracking-wider">
                  New Protocol Fee
                </label>
                <div className="flex items-baseline gap-2">
                  <input
                    type="number"
                    value={formData.protocolFeeBps}
                    onChange={(e) => setFormData({ ...formData, protocolFeeBps: e.target.value })}
                    className="w-24 px-3 py-2 bg-[#0a0a0a] border border-[#262626] rounded-lg text-white text-lg font-semibold focus:outline-none focus:ring-2 focus:ring-white/20 focus:border-transparent transition-all"
                    min="0"
                    max="10000"
                    placeholder="—"
                  />
                  <span className="text-[#525252] text-sm">basis points</span>
                </div>
                <p className="mt-2 text-xs text-[#525252]">
                  Leave empty to keep current value
                </p>
              </div>

              <div className="bg-[#111111] rounded-xl p-5 border border-[#1a1a1a]">
                <label className="block text-xs font-medium text-[#737373] mb-3 uppercase tracking-wider">
                  New Insurance Fee
                </label>
                <div className="flex items-baseline gap-2">
                  <input
                    type="number"
                    value={formData.insuranceFeeBps}
                    onChange={(e) => setFormData({ ...formData, insuranceFeeBps: e.target.value })}
                    className="w-24 px-3 py-2 bg-[#0a0a0a] border border-[#262626] rounded-lg text-white text-lg font-semibold focus:outline-none focus:ring-2 focus:ring-white/20 focus:border-transparent transition-all"
                    min="0"
                    max="10000"
                    placeholder="—"
                  />
                  <span className="text-[#525252] text-sm">basis points</span>
                </div>
                <p className="mt-2 text-xs text-[#525252]">
                  Leave empty to keep current value
                </p>
              </div>
            </div>

            {/* Info */}
            <div className="bg-[#111111] rounded-xl p-4 border border-[#1a1a1a]">
              <div className="flex items-start gap-3">
                <svg className="w-5 h-5 text-[#737373] shrink-0 mt-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
                <div>
                  <h3 className="text-sm font-semibold text-white mb-1">Note</h3>
                  <ul className="text-xs text-[#737373] space-y-1">
                    <li>• Only admin can update config parameters.</li>
                    <li>• Creator fee is stored in market accounts, not config.</li>
                    <li>• Changes take effect immediately for new trades.</li>
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
                  Updating...
                </>
              ) : (
                <>
                  Update Config
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
