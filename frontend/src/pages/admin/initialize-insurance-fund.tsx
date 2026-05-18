import { useState } from 'react';
import { AdminLayout } from '@/components/AdminLayout';
import { useWallet } from '@solana/wallet-adapter-react';
import { useSpaceProgram } from '@/hooks/useSpaceProgram';
import { usdcToLamports } from '@/utils/solana';
import { isAdminWallet } from '@/utils/admin';

export default function InitializeInsuranceFund() {
  const { connected, publicKey } = useWallet();
  const { initializeInsuranceFund, isReady, loading } = useSpaceProgram();
  
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  
  // Default value: 10,000 USDC
  const [initialBalance, setInitialBalance] = useState<number>(10000);

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

    if (initialBalance <= 0) {
      setError('Initial balance must be greater than 0');
      return;
    }

    try {
      // Convert USDC to lamports (6 decimals)
      const balanceInLamports = usdcToLamports(initialBalance);
      
      const result = await initializeInsuranceFund(balanceInLamports);

      setSuccess(
        `Insurance fund initialized successfully!\n` +
        `Initial Balance: ${initialBalance.toLocaleString()} USDC\n` +
        `Transaction: ${result.transaction}\n\n` +
        `View on Solscan: https://solscan.io/tx/${result.transaction}`
      );
    } catch (err: any) {
      console.error('Error initializing insurance fund:', err);
      setError(err.message || 'Failed to initialize insurance fund');
    }
  };

  // Auth is handled by AdminLayout
  if (!isAdmin) {
    return <AdminLayout title="Insurance Fund" description="Initialize the insurance fund" />;
  }

  return (
    <AdminLayout title="Insurance Fund" description="Create and fund the insurance vault for liquidation penalties">
      <div className="max-w-2xl">
        {/* Header Card */}
        <div className="bg-gradient-to-r from-[#0a0a0a] to-[#111111] rounded-2xl p-6 border border-[#1a1a1a] mb-6">
          <div className="flex items-center gap-4">
            <div className="w-12 h-12 rounded-xl bg-emerald-500/10 border border-emerald-500/20 flex items-center justify-center">
              <span className="text-2xl">🛡️</span>
            </div>
            <div>
              <h2 className="text-lg font-semibold text-white">Insurance Fund Setup</h2>
              <p className="text-sm text-[#737373]">Protect the protocol with an insurance vault</p>
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
                <p className="text-amber-400 text-sm">Please connect your wallet to initialize the insurance fund.</p>
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
            {/* Amount Input */}
            <div>
              <label className="block text-sm font-medium text-white mb-3">
                Initial Balance
              </label>
              <div className="relative">
                <input
                  type="number"
                  value={initialBalance}
                  onChange={(e) => setInitialBalance(parseFloat(e.target.value) || 0)}
                  className="w-full px-4 py-4 bg-[#111111] border border-[#262626] rounded-xl text-white text-xl font-semibold focus:outline-none focus:ring-2 focus:ring-white/20 focus:border-transparent pr-20 transition-all"
                  placeholder="10000"
                  min="1"
                  step="100"
                  required
                />
                <span className="absolute right-4 top-1/2 -translate-y-1/2 text-[#525252] font-medium">
                  USDC
                </span>
              </div>
              
              {/* Quick amount buttons */}
              <div className="mt-3 flex gap-2">
                {[1000, 5000, 10000, 25000, 50000].map((amount) => (
                  <button
                    key={amount}
                    type="button"
                    onClick={() => setInitialBalance(amount)}
                    className={`px-3 py-1.5 text-xs rounded-lg transition-colors ${
                      initialBalance === amount
                        ? 'bg-white text-black font-semibold'
                        : 'bg-[#171717] text-[#737373] hover:bg-[#262626] hover:text-white'
                    }`}
                  >
                    {(amount / 1000).toFixed(0)}K
                  </button>
                ))}
              </div>

              <div className="mt-4 p-3 bg-[#111111] rounded-xl border border-[#1a1a1a]">
                <p className="text-xs text-[#737373]">
                  <span className="font-semibold text-white">Amount in lamports:</span>{' '}
                  <span className="font-mono">{usdcToLamports(initialBalance).toLocaleString()}</span>
                </p>
              </div>
            </div>

            {/* How It Works */}
            <div className="bg-[#111111] rounded-xl border border-[#1a1a1a] overflow-hidden">
              <div className="px-4 py-3 border-b border-[#1a1a1a]">
                <h3 className="text-sm font-semibold text-white">How It Works</h3>
              </div>
              <div className="p-4 space-y-3">
                {[
                  { step: '1', title: 'Initialization', desc: 'The insurance fund vault is created as a token account owned by a PDA.' },
                  { step: '2', title: 'Funding', desc: 'Your USDC is transferred to the vault during initialization.' },
                  { step: '3', title: 'Liquidations', desc: 'When positions are liquidated, 10% of the penalty goes to this fund.' },
                  { step: '4', title: 'Protection', desc: 'The fund acts as a safety net for the protocol.' },
                ].map((item, idx) => (
                  <div key={idx} className="flex items-start gap-3">
                    <div className="w-6 h-6 rounded-full bg-[#171717] border border-[#262626] flex items-center justify-center shrink-0">
                      <span className="text-xs text-[#737373] font-medium">{item.step}</span>
                    </div>
                    <div>
                      <h4 className="text-sm font-medium text-white">{item.title}</h4>
                      <p className="text-xs text-[#525252]">{item.desc}</p>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* Info */}
            <div className="bg-[#111111] rounded-xl p-4 border border-[#1a1a1a]">
              <div className="flex items-start gap-3">
                <svg className="w-5 h-5 text-[#737373] shrink-0 mt-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
                <div>
                  <h3 className="text-sm font-semibold text-white mb-1">About Insurance Fund</h3>
                  <ul className="text-xs text-[#737373] space-y-1">
                    <li>• Insurance fund receives <span className="text-white">10%</span> of liquidation penalties</li>
                    <li>• Liquidators receive <span className="text-white">5%</span> of penalties as rewards</li>
                    <li>• Helps cover shortfalls if positions can't be fully liquidated</li>
                    <li>• Can be topped up later by admin if needed</li>
                  </ul>
                </div>
              </div>
            </div>

            {/* Warning */}
            <div className="bg-amber-500/5 border border-amber-500/20 rounded-xl p-4">
              <div className="flex items-start gap-3">
                <svg className="w-5 h-5 text-amber-400 shrink-0 mt-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                </svg>
                <div>
                  <h3 className="text-sm font-semibold text-amber-400 mb-1">Important</h3>
                  <ul className="text-xs text-[#a3a3a3] space-y-1">
                    <li>• This can only be done <span className="text-white font-medium">once</span></li>
                    <li>• You must be the protocol admin</li>
                    <li>• Ensure sufficient USDC and SOL in your wallet</li>
                  </ul>
                </div>
              </div>
            </div>

            <div className="flex items-center gap-4">
              <button
                type="button"
                onClick={() => window.history.back()}
                className="flex-1 px-6 py-4 bg-[#171717] hover:bg-[#262626] text-white font-medium rounded-xl transition-colors"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={!connected || !isReady || loading || initialBalance <= 0}
                className="flex-1 px-6 py-4 bg-white hover:bg-neutral-200 text-black font-semibold rounded-xl transition-all disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
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
                    Initialize Fund
                    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 7l5 5m0 0l-5 5m5-5H6" />
                    </svg>
                  </>
                )}
              </button>
            </div>
          </form>
        </div>
      </div>
    </AdminLayout>
  );
}
