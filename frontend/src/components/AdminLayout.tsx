'use client';

import Head from 'next/head';
import Link from 'next/link';
import { useRouter } from 'next/router';
import { useWallet } from '@solana/wallet-adapter-react';
import { ReactNode, useState } from 'react';
import { isAdminWallet } from '../utils/admin';

interface AdminLayoutProps {
  children?: ReactNode;
  title?: string;
  description?: string;
}

const navItems = [
  {
    label: 'Dashboard',
    href: '/admin',
    icon: (
      <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6" />
      </svg>
    ),
  },
  {
    label: 'Setup',
    icon: (
      <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
      </svg>
    ),
    children: [
      { label: 'Initialize Config', href: '/admin/initialize-config' },
      { label: 'Oracle Registry', href: '/admin/oracle-registry' },
      { label: 'Insurance Fund', href: '/admin/initialize-insurance-fund' },
      { label: 'Update Config', href: '/admin/update-config' },
    ],
  },
  {
    label: 'Markets',
    icon: (
      <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
      </svg>
    ),
    children: [
      { label: 'Create Market', href: '/admin/create-market' },
      { label: 'Resolve Market', href: '/admin/resolve-market' },
      { label: 'Migrate to v2', href: '/admin/migrate-markets' },
    ],
  },
  {
    label: 'Liquidity',
    icon: (
      <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
      </svg>
    ),
    children: [
      { label: 'Fund Market Vault', href: '/admin/fund-market-vault' },
      { label: 'Fund Liquidity Vault', href: '/admin/fund-liquidity-vault' },
      { label: 'Seed Order Book', href: '/admin/seed-order-book' },
    ],
  },
  {
    label: 'Competitions',
    href: '/admin/manage-competitions',
    icon: (
      <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M16 4v12l-4-2-4 2V4M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
      </svg>
    ),
  },
  {
    label: 'Guide',
    href: '/admin/guide',
    icon: (
      <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253" />
      </svg>
    ),
  },
];

export function AdminLayout({ children, title = 'Admin', description }: AdminLayoutProps) {
  const router = useRouter();
  const { connected, publicKey } = useWallet();
  const [expandedSections, setExpandedSections] = useState<string[]>(['Setup', 'Markets', 'Liquidity']);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);

  const isAdmin = isAdminWallet(connected, publicKey);

  const toggleSection = (label: string) => {
    setExpandedSections(prev =>
      prev.includes(label) ? prev.filter(l => l !== label) : [...prev, label]
    );
  };

  const isActive = (href: string) => router.pathname === href;
  const isParentActive = (children: { href: string }[]) =>
    children.some(child => router.pathname === child.href);

  // Not connected state
  if (!connected) {
    return (
      <>
        <Head>
          <title>{title} - Space Admin</title>
        </Head>
        <div className="min-h-screen bg-[#0a0a0a] flex items-center justify-center">
          <div className="text-center">
            <div className="w-16 h-16 mx-auto mb-6 rounded-2xl bg-[#1a1a1a] border border-[#262626] flex items-center justify-center">
              <svg className="w-8 h-8 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
              </svg>
            </div>
            <h1 className="text-2xl font-bold text-white mb-2">Admin Dashboard</h1>
            <p className="text-[#737373] mb-6">Connect your wallet to access admin functions</p>
          </div>
        </div>
      </>
    );
  }

  // Not admin state
  if (!isAdmin) {
    return (
      <>
        <Head>
          <title>Access Denied - Space Admin</title>
        </Head>
        <div className="min-h-screen bg-[#0a0a0a] flex items-center justify-center">
          <div className="text-center">
            <div className="w-16 h-16 mx-auto mb-6 rounded-2xl bg-red-500/10 border border-red-500/20 flex items-center justify-center">
              <svg className="w-8 h-8 text-red-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
              </svg>
            </div>
            <h1 className="text-2xl font-bold text-white mb-2">Access Denied</h1>
            <p className="text-[#737373] mb-4">You are not authorized to access admin functions.</p>
            <p className="text-[#525252] text-sm font-mono">
              {publicKey?.toString().slice(0, 8)}...{publicKey?.toString().slice(-8)}
            </p>
            <Link
              href="/"
              className="inline-block mt-6 px-4 py-2 text-sm text-white bg-[#1a1a1a] border border-[#262626] rounded-lg hover:bg-[#262626] transition-colors"
            >
              ← Back to Home
            </Link>
          </div>
        </div>
      </>
    );
  }

  return (
    <>
      <Head>
        <title>{title} - Space Admin</title>
        {description && <meta name="description" content={description} />}
      </Head>

      <div className="min-h-screen bg-[#0a0a0a] flex">
        {/* Sidebar */}
        <aside
          className={`fixed left-0 top-0 h-full bg-[#0f0f0f] border-r border-[#1a1a1a] z-40 transition-all duration-300 ${
            sidebarCollapsed ? 'w-16' : 'w-64'
          }`}
        >
          {/* Logo */}
          <div className="h-16 flex items-center justify-between px-4 border-b border-[#1a1a1a]">
            {!sidebarCollapsed && (
              <Link href="/admin" className="flex items-center gap-2">
                <div className="w-8 h-8 rounded-lg bg-white flex items-center justify-center">
                  <span className="text-black font-bold text-sm">S</span>
                </div>
                <span className="font-semibold text-white">Admin</span>
              </Link>
            )}
            <button
              onClick={() => setSidebarCollapsed(!sidebarCollapsed)}
              className="p-2 rounded-lg hover:bg-[#1a1a1a] text-[#737373] hover:text-white transition-colors"
            >
              <svg className={`w-5 h-5 transition-transform ${sidebarCollapsed ? 'rotate-180' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M11 19l-7-7 7-7m8 14l-7-7 7-7" />
              </svg>
            </button>
          </div>

          {/* Navigation */}
          <nav className="p-3 space-y-1 overflow-y-auto h-[calc(100%-8rem)]">
            {navItems.map((item) => (
              <div key={item.label}>
                {item.href ? (
                  // Direct link (Dashboard)
                  <Link
                    href={item.href}
                    className={`flex items-center gap-3 px-3 py-2.5 rounded-lg transition-all ${
                      isActive(item.href)
                        ? 'bg-white text-black'
                        : 'text-[#a3a3a3] hover:text-white hover:bg-[#1a1a1a]'
                    }`}
                  >
                    {item.icon}
                    {!sidebarCollapsed && <span className="font-medium text-sm">{item.label}</span>}
                  </Link>
                ) : (
                  // Expandable section
                  <>
                    <button
                      onClick={() => toggleSection(item.label)}
                      className={`w-full flex items-center justify-between px-3 py-2.5 rounded-lg transition-all ${
                        item.children && isParentActive(item.children)
                          ? 'text-white'
                          : 'text-[#a3a3a3] hover:text-white hover:bg-[#1a1a1a]'
                      }`}
                    >
                      <div className="flex items-center gap-3">
                        {item.icon}
                        {!sidebarCollapsed && <span className="font-medium text-sm">{item.label}</span>}
                      </div>
                      {!sidebarCollapsed && item.children && (
                        <svg
                          className={`w-4 h-4 transition-transform ${
                            expandedSections.includes(item.label) ? 'rotate-180' : ''
                          }`}
                          fill="none"
                          viewBox="0 0 24 24"
                          stroke="currentColor"
                        >
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                        </svg>
                      )}
                    </button>
                    {!sidebarCollapsed && item.children && expandedSections.includes(item.label) && (
                      <div className="ml-4 mt-1 space-y-1 border-l border-[#262626] pl-4">
                        {item.children.map((child) => (
                          <Link
                            key={child.href}
                            href={child.href}
                            className={`block px-3 py-2 rounded-lg text-sm transition-all ${
                              isActive(child.href)
                                ? 'bg-white/10 text-white'
                                : 'text-[#737373] hover:text-white hover:bg-[#1a1a1a]'
                            }`}
                          >
                            {child.label}
                          </Link>
                        ))}
                      </div>
                    )}
                  </>
                )}
              </div>
            ))}
          </nav>

          {/* Footer */}
          <div className="absolute bottom-0 left-0 right-0 p-3 border-t border-[#1a1a1a]">
            <Link
              href="/"
              className={`flex items-center gap-3 px-3 py-2.5 rounded-lg text-[#737373] hover:text-white hover:bg-[#1a1a1a] transition-all ${
                sidebarCollapsed ? 'justify-center' : ''
              }`}
            >
              <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M11 17l-5-5m0 0l5-5m-5 5h12" />
              </svg>
              {!sidebarCollapsed && <span className="font-medium text-sm">Back to App</span>}
            </Link>
          </div>
        </aside>

        {/* Main Content */}
        <main
          className={`flex-1 transition-all duration-300 ${
            sidebarCollapsed ? 'ml-16' : 'ml-64'
          }`}
        >
          {/* Top Bar */}
          <header className="h-16 border-b border-[#1a1a1a] bg-[#0a0a0a]/80 backdrop-blur-sm sticky top-0 z-30 flex items-center justify-between px-6">
            <div>
              <h1 className="text-lg font-semibold text-white">{title}</h1>
              {description && <p className="text-xs text-[#737373]">{description}</p>}
            </div>
            <div className="flex items-center gap-4">
              {/* Network Badge */}
              <div className="flex items-center gap-2 px-3 py-1.5 bg-[#1a1a1a] rounded-lg border border-[#262626]">
                <div className="w-2 h-2 rounded-full bg-green-400 animate-pulse" />
                <span className="text-xs text-[#a3a3a3]">Devnet</span>
              </div>
              {/* Wallet */}
              <div className="flex items-center gap-2 px-3 py-1.5 bg-[#1a1a1a] rounded-lg border border-[#262626]">
                <svg className="w-4 h-4 text-[#737373]" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M17 9V7a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2m2 4h10a2 2 0 002-2v-6a2 2 0 00-2-2H9a2 2 0 00-2 2v6a2 2 0 002 2zm7-5a2 2 0 11-4 0 2 2 0 014 0z" />
                </svg>
                <span className="text-xs text-[#a3a3a3] font-mono">
                  {publicKey?.toString().slice(0, 4)}...{publicKey?.toString().slice(-4)}
                </span>
              </div>
            </div>
          </header>

          {/* Page Content */}
          <div className="p-6">
            {children}
          </div>
        </main>
      </div>
    </>
  );
}
