import { useState, useEffect, useCallback, useRef } from 'react';
import { AdminLayout } from '@/components/AdminLayout';
import { useWallet } from '@solana/wallet-adapter-react';
import { useSpaceProgram } from '@/hooks/useSpaceProgram';
import { PublicKey } from '@solana/web3.js';
import { isAdminWallet } from '@/utils/admin';

export default function OracleRegistry() {
  const { connected, publicKey } = useWallet();
  const { initializeOracleRegistry, addApprovedOracle, fetchOracleRegistry, isReady, loading } = useSpaceProgram();
  
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [newOracleAddress, setNewOracleAddress] = useState('');
  const [registryData, setRegistryData] = useState<{
    address: PublicKey;
    approvedOracles: PublicKey[];
  } | null>(null);
  const [isInitialized, setIsInitialized] = useState<boolean | null>(null);
  const [fetching, setFetching] = useState(false);
  const hasFetched = useRef(false);

  const isAdmin = isAdminWallet(connected, publicKey);

  // Memoize the load function to avoid re-renders
  const loadRegistry = useCallback(async () => {
    if (!isReady) return;
    
    setFetching(true);
    try {
      const data = await fetchOracleRegistry();
      
      if (data) {
        setRegistryData(data);
        setIsInitialized(true);
      } else {
        // Not initialized yet - this is expected
        setRegistryData(null);
        setIsInitialized(false);
      }
    } catch (err: any) {
      // Account not found means not initialized - not an error
      console.log('Registry check:', err?.message || 'Not initialized');
      setIsInitialized(false);
      setRegistryData(null);
    } finally {
      setFetching(false);
    }
  }, [isReady, fetchOracleRegistry]);

  // Fetch oracle registry on mount - only once when ready
  useEffect(() => {
    if (isReady && !hasFetched.current) {
      hasFetched.current = true;
      loadRegistry();
    }
  }, [isReady, loadRegistry]);

  const handleInitialize = async () => {
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
      const result = await initializeOracleRegistry();
      setSuccess(`Oracle Registry initialized successfully!\n\nTransaction: ${result.transaction}`);
      setIsInitialized(true);
      
      // Refresh registry data
      const data = await fetchOracleRegistry();
      if (data) setRegistryData(data);
    } catch (err: any) {
      console.error('Error initializing oracle registry:', err);
      setError(err.message || 'Failed to initialize oracle registry');
    }
  };

  const handleAddOracle = async (e: React.FormEvent) => {
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

    if (!newOracleAddress.trim()) {
      setError('Please enter an oracle address');
      return;
    }

    try {
      const oraclePubkey = new PublicKey(newOracleAddress.trim());
      const result = await addApprovedOracle(oraclePubkey);
      setSuccess(`Oracle added successfully!\n\nOracle: ${oraclePubkey.toString()}\nTransaction: ${result.transaction}`);
      setNewOracleAddress('');
      
      // Refresh registry data
      const data = await fetchOracleRegistry();
      if (data) setRegistryData(data);
    } catch (err: any) {
      console.error('Error adding oracle:', err);
      if (err.message?.includes('Invalid public key')) {
        setError('Invalid public key format. Please enter a valid Solana address.');
      } else {
        setError(err.message || 'Failed to add oracle');
      }
    }
  };

  const handleAddSelf = async () => {
    if (!publicKey) return;
    setNewOracleAddress(publicKey.toString());
  };

  // Auth is handled by AdminLayout
  if (!isAdmin) {
    return <AdminLayout title="Oracle Registry" description="Manage approved oracles" />;
  }

  return (
    <AdminLayout title="Oracle Registry" description="Initialize registry and manage approved oracles for market resolution">
      <div className="max-w-3xl">
        {/* Header Card */}
        <div className="bg-gradient-to-r from-[#0a0a0a] to-[#111111] rounded-2xl p-6 border border-[#1a1a1a] mb-6">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-4">
              <div className="w-12 h-12 rounded-xl bg-purple-500/10 border border-purple-500/20 flex items-center justify-center">
                <span className="text-2xl">🔮</span>
              </div>
              <div>
                <h2 className="text-lg font-semibold text-white">Oracle Management</h2>
                <p className="text-sm text-[#737373]">Configure approved oracles for market resolution</p>
              </div>
            </div>
            <div className={`px-3 py-1.5 rounded-full text-xs font-medium ${
              isInitialized === null 
                ? 'bg-[#262626] text-[#737373]' 
                : isInitialized 
                  ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20' 
                  : 'bg-amber-500/10 text-amber-400 border border-amber-500/20'
            }`}>
              {isInitialized === null ? 'Loading...' : isInitialized ? '● Initialized' : '○ Not Initialized'}
            </div>
          </div>
        </div>

        {/* Alerts */}
        <div className="space-y-4 mb-6">
          {!connected && (
            <div className="bg-amber-500/10 border border-amber-500/20 rounded-xl p-4 flex items-start gap-3">
              <svg className="w-5 h-5 text-amber-400 shrink-0 mt-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
              </svg>
              <p className="text-amber-400 text-sm">Please connect your wallet to manage the oracle registry.</p>
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

        {/* Initialize Section */}
        {isInitialized === false && (
          <div className="bg-[#0a0a0a] rounded-2xl border border-[#1a1a1a] p-6 mb-6">
            <div className="flex items-start gap-4">
              <div className="w-10 h-10 rounded-xl bg-purple-500/10 border border-purple-500/20 flex items-center justify-center shrink-0">
                <span className="text-lg">🔐</span>
              </div>
              <div className="flex-1">
                <h3 className="text-lg font-semibold text-white mb-2">Initialize Oracle Registry</h3>
                <p className="text-sm text-[#737373] mb-4">
                  The Oracle Registry needs to be initialized before you can add approved oracles.
                  This is a one-time setup operation.
                </p>
                <button
                  onClick={handleInitialize}
                  disabled={!connected || !isReady || loading}
                  className="px-6 py-3 bg-white hover:bg-neutral-200 text-black font-semibold rounded-xl transition-all disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
                >
                  {loading ? (
                    <>
                      <svg className="animate-spin h-4 w-4" fill="none" viewBox="0 0 24 24">
                        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                      </svg>
                      Initializing...
                    </>
                  ) : (
                    <>Initialize Registry</>
                  )}
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Current Oracles Section */}
        {isInitialized && (
          <div className="bg-[#0a0a0a] rounded-2xl border border-[#1a1a1a] overflow-hidden mb-6">
            <div className="px-6 py-4 border-b border-[#1a1a1a] flex items-center justify-between">
              <div className="flex items-center gap-3">
                <span className="text-lg">👥</span>
                <h3 className="font-semibold text-white">Approved Oracles</h3>
              </div>
              <span className="px-2 py-1 bg-[#171717] rounded-lg text-xs text-[#737373] font-mono">
                {registryData?.approvedOracles.length || 0} / 10
              </span>
            </div>
            
            <div className="p-4">
              {registryData && registryData.approvedOracles.length > 0 ? (
                <div className="space-y-2">
                  {registryData.approvedOracles.map((oracle, index) => (
                    <div
                      key={oracle.toString()}
                      className="flex items-center justify-between bg-[#111111] rounded-xl p-4 border border-[#1a1a1a]"
                    >
                      <div className="flex items-center gap-3">
                        <div className="w-8 h-8 rounded-lg bg-[#171717] border border-[#262626] flex items-center justify-center">
                          <span className="text-[#525252] text-xs font-medium">{index + 1}</span>
                        </div>
                        <code className="text-sm text-[#a3a3a3] font-mono">
                          {oracle.toString()}
                        </code>
                      </div>
                      {oracle.toString() === publicKey?.toString() && (
                        <span className="px-2 py-1 bg-white/5 text-white text-xs rounded-lg border border-[#262626]">
                          You
                        </span>
                      )}
                    </div>
                  ))}
                </div>
              ) : (
                <div className="text-center py-8">
                  <div className="w-16 h-16 rounded-2xl bg-[#111111] border border-[#1a1a1a] flex items-center justify-center mx-auto mb-4">
                    <span className="text-2xl opacity-50">👤</span>
                  </div>
                  <p className="text-[#737373] text-sm">No oracles registered yet</p>
                  <p className="text-[#525252] text-xs mt-1">Add an oracle below to get started</p>
                </div>
              )}

              {registryData?.address && (
                <div className="mt-4 pt-4 border-t border-[#1a1a1a]">
                  <p className="text-xs text-[#525252]">
                    Registry PDA: <code className="font-mono text-[#737373]">{registryData.address.toString()}</code>
                  </p>
                </div>
              )}
            </div>
          </div>
        )}

        {/* Add Oracle Section */}
        {isInitialized && (
          <div className="bg-[#0a0a0a] rounded-2xl border border-[#1a1a1a] overflow-hidden mb-6">
            <div className="px-6 py-4 border-b border-[#1a1a1a] flex items-center gap-3">
              <span className="text-lg">➕</span>
              <h3 className="font-semibold text-white">Add Approved Oracle</h3>
            </div>
            
            <form onSubmit={handleAddOracle} className="p-6 space-y-4">
              <div>
                <label className="block text-sm font-medium text-[#737373] mb-2">
                  Oracle Wallet Address
                </label>
                <div className="flex gap-2">
                  <input
                    type="text"
                    value={newOracleAddress}
                    onChange={(e) => setNewOracleAddress(e.target.value)}
                    className="flex-1 px-4 py-3 bg-[#111111] border border-[#262626] rounded-xl text-white font-mono text-sm focus:outline-none focus:ring-2 focus:ring-white/20 focus:border-transparent transition-all"
                    placeholder="Enter Solana wallet address..."
                    required
                  />
                  <button
                    type="button"
                    onClick={handleAddSelf}
                    className="px-4 py-3 bg-[#171717] text-[#a3a3a3] rounded-xl hover:bg-[#262626] hover:text-white transition-colors text-sm font-medium whitespace-nowrap"
                  >
                    Use Mine
                  </button>
                </div>
                <p className="mt-2 text-xs text-[#525252]">
                  This wallet will be able to resolve markets using the Oracle resolution type.
                </p>
              </div>

              {/* Who can resolve */}
              <div className="bg-[#111111] rounded-xl p-4 border border-[#1a1a1a]">
                <div className="flex items-start gap-3">
                  <svg className="w-5 h-5 text-[#737373] shrink-0 mt-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z" />
                  </svg>
                  <div>
                    <h4 className="text-sm font-semibold text-white mb-1">Who can resolve markets?</h4>
                    <ul className="text-xs text-[#737373] space-y-1">
                      <li>• <span className="text-white">Admin</span> - Protocol administrator</li>
                      <li>• <span className="text-white">Market Creator</span> - Wallet that created the market</li>
                      <li>• <span className="text-white">Approved Oracle</span> - Wallets added to this registry</li>
                    </ul>
                  </div>
                </div>
              </div>

              <button
                type="submit"
                disabled={!connected || !isReady || loading || !newOracleAddress.trim()}
                className="w-full px-6 py-4 bg-white hover:bg-neutral-200 text-black font-semibold rounded-xl transition-all disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
              >
                {loading ? (
                  <>
                    <svg className="animate-spin h-5 w-5" fill="none" viewBox="0 0 24 24">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                    </svg>
                    Adding Oracle...
                  </>
                ) : (
                  <>
                    Add Oracle
                    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                    </svg>
                  </>
                )}
              </button>
            </form>
          </div>
        )}

        {/* Security Notes */}
        <div className="bg-amber-500/5 border border-amber-500/20 rounded-2xl p-5">
          <div className="flex items-start gap-3">
            <svg className="w-5 h-5 text-amber-400 shrink-0 mt-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
            </svg>
            <div>
              <h3 className="text-sm font-semibold text-amber-400 mb-2">Security Notes</h3>
              <ul className="text-xs text-[#a3a3a3] space-y-1">
                <li>• Only the protocol admin can initialize the registry and add oracles</li>
                <li>• Maximum of <span className="text-white">10 oracles</span> can be registered</li>
                <li>• Approved oracles have authority to resolve any Oracle-type market</li>
                <li>• Review oracle addresses carefully before adding</li>
              </ul>
            </div>
          </div>
        </div>
      </div>
    </AdminLayout>
  );
}
