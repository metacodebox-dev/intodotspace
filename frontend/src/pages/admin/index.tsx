import { useState, useEffect } from 'react';
import { AdminLayout } from '@/components/AdminLayout';
import { useWallet, useConnection } from '@solana/wallet-adapter-react';
import Link from 'next/link';
import { isAdminWallet } from '@/utils/admin';

interface QuickAction {
  title: string;
  description: string;
  href: string;
  icon: string;
  color: string;
}

const quickActions: QuickAction[] = [
  {
    title: 'Create Market',
    description: 'Launch a new prediction market',
    href: '/admin/create-market',
    icon: '📊',
    color: 'from-blue-500/10 to-blue-600/5 border-blue-500/20 hover:border-blue-500/40',
  },
  {
    title: 'Resolve Market',
    description: 'Finalize market outcomes',
    href: '/admin/resolve-market',
    icon: '🏆',
    color: 'from-amber-500/10 to-amber-600/5 border-amber-500/20 hover:border-amber-500/40',
  },
  {
    title: 'Fund Market Vault',
    description: 'Add liquidity to markets',
    href: '/admin/fund-market-vault',
    icon: '💰',
    color: 'from-emerald-500/10 to-emerald-600/5 border-emerald-500/20 hover:border-emerald-500/40',
  },
  {
    title: 'Fund Liquidity Vault',
    description: 'Enable leverage trading',
    href: '/admin/fund-liquidity-vault',
    icon: '🏦',
    color: 'from-cyan-500/10 to-cyan-600/5 border-cyan-500/20 hover:border-cyan-500/40',
  },
];

const setupActions: QuickAction[] = [
  {
    title: 'Initialize Config',
    description: 'First-time protocol setup',
    href: '/admin/initialize-config',
    icon: '⚙️',
    color: 'from-purple-500/10 to-purple-600/5 border-purple-500/20 hover:border-purple-500/40',
  },
  {
    title: 'Oracle Registry',
    description: 'Manage approved oracles',
    href: '/admin/oracle-registry',
    icon: '🔮',
    color: 'from-pink-500/10 to-pink-600/5 border-pink-500/20 hover:border-pink-500/40',
  },
  {
    title: 'Insurance Fund',
    description: 'Initialize insurance vault',
    href: '/admin/initialize-insurance-fund',
    icon: '🛡️',
    color: 'from-green-500/10 to-green-600/5 border-green-500/20 hover:border-green-500/40',
  },
  {
    title: 'Update Config',
    description: 'Modify protocol settings',
    href: '/admin/update-config',
    icon: '📝',
    color: 'from-orange-500/10 to-orange-600/5 border-orange-500/20 hover:border-orange-500/40',
  },
];

export default function AdminDashboard() {
  const { connected, publicKey } = useWallet();
  const { connection } = useConnection();
  const [solBalance, setSolBalance] = useState<number | null>(null);

  const isAdmin = isAdminWallet(connected, publicKey);

  useEffect(() => {
    const fetchBalance = async () => {
      if (publicKey && connection) {
        try {
          const balance = await connection.getBalance(publicKey);
          setSolBalance(balance / 1e9);
        } catch (err) {
          console.error('Error fetching balance:', err);
        }
      }
    };

    fetchBalance();
  }, [publicKey, connection]);

  // Auth is handled by AdminLayout
  if (!connected || !isAdmin) {
    return <AdminLayout title="Dashboard" description="Overview of admin functions" />;
  }

  return (
    <AdminLayout title="Dashboard" description="Overview of admin functions">
      {/* Welcome Card */}
      <div className="bg-gradient-to-br from-[#111111] via-[#0a0a0a] to-[#111111] rounded-2xl p-8 border border-[#1a1a1a] mb-8 relative overflow-hidden">
        <div className="absolute top-0 right-0 w-64 h-64 bg-white/[0.02] rounded-full blur-3xl -translate-y-1/2 translate-x-1/2"></div>
        <div className="relative">
          <div className="flex items-center gap-3 mb-4">
            <div className="w-12 h-12 rounded-xl bg-white/5 border border-[#262626] flex items-center justify-center">
              <span className="text-2xl">👋</span>
            </div>
            <div>
              <h2 className="text-2xl font-bold text-white">Welcome, Admin</h2>
              <p className="text-[#737373] text-sm">Manage your prediction market protocol</p>
            </div>
          </div>
          <div className="flex items-center gap-6 mt-6">
            <div className="flex items-center gap-2">
              <div className="w-2 h-2 rounded-full bg-emerald-400"></div>
              <span className="text-sm text-[#a3a3a3]">Protocol Active</span>
            </div>
            {solBalance !== null && (
              <div className="flex items-center gap-2 text-sm text-[#737373]">
                <span>Balance:</span>
                <span className="text-white font-mono">{solBalance.toFixed(4)} SOL</span>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Quick Actions */}
      <div className="mb-8">
        <h3 className="text-lg font-semibold text-white mb-4 flex items-center gap-2">
          <span>⚡</span> Quick Actions
        </h3>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
          {quickActions.map((action, idx) => (
            <Link
              key={idx}
              href={action.href}
              className={`group bg-gradient-to-br ${action.color} rounded-2xl p-5 border transition-all hover:scale-[1.02] hover:shadow-lg`}
            >
              <div className="flex items-start justify-between mb-4">
                <span className="text-3xl">{action.icon}</span>
                <svg className="w-5 h-5 text-[#525252] group-hover:text-white transition-colors" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M14 5l7 7m0 0l-7 7m7-7H3" />
                </svg>
              </div>
              <h4 className="font-semibold text-white mb-1">{action.title}</h4>
              <p className="text-xs text-[#737373]">{action.description}</p>
            </Link>
          ))}
        </div>
      </div>

      {/* Setup & Configuration */}
      <div className="mb-8">
        <h3 className="text-lg font-semibold text-white mb-4 flex items-center gap-2">
          <span>🔧</span> Setup & Configuration
        </h3>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
          {setupActions.map((action, idx) => (
            <Link
              key={idx}
              href={action.href}
              className={`group bg-gradient-to-br ${action.color} rounded-2xl p-5 border transition-all hover:scale-[1.02] hover:shadow-lg`}
            >
              <div className="flex items-start justify-between mb-4">
                <span className="text-3xl">{action.icon}</span>
                <svg className="w-5 h-5 text-[#525252] group-hover:text-white transition-colors" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M14 5l7 7m0 0l-7 7m7-7H3" />
                </svg>
              </div>
              <h4 className="font-semibold text-white mb-1">{action.title}</h4>
              <p className="text-xs text-[#737373]">{action.description}</p>
            </Link>
          ))}
        </div>
      </div>

      {/* Getting Started Guide */}
      <div className="bg-[#0a0a0a] rounded-2xl border border-[#1a1a1a] overflow-hidden">
        <div className="px-6 py-4 border-b border-[#1a1a1a]">
          <h3 className="font-semibold text-white flex items-center gap-2">
            <span>📚</span> Getting Started
          </h3>
        </div>
        <div className="p-6">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            {[
              {
                step: '1',
                title: 'Initialize Protocol',
                desc: 'Set up config, oracle registry, and insurance fund',
                color: 'emerald',
              },
              {
                step: '2',
                title: 'Create Markets',
                desc: 'Launch prediction markets with initial liquidity',
                color: 'blue',
              },
              {
                step: '3',
                title: 'Manage & Resolve',
                desc: 'Fund vaults and resolve markets when they expire',
                color: 'purple',
              },
            ].map((item, idx) => (
              <div key={idx} className="flex items-start gap-4">
                <div className={`w-10 h-10 rounded-xl bg-${item.color}-500/10 border border-${item.color}-500/20 flex items-center justify-center shrink-0`}>
                  <span className={`text-${item.color}-400 font-bold`}>{item.step}</span>
                </div>
                <div>
                  <h4 className="text-sm font-semibold text-white mb-1">{item.title}</h4>
                  <p className="text-xs text-[#525252]">{item.desc}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </AdminLayout>
  );
}
