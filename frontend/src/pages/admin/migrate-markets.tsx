import { useCallback, useEffect, useState } from 'react';
import { AdminLayout } from '@/components/AdminLayout';

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001';
const TOKEN_STORAGE_KEY = 'space_auth_token';

interface V1Market {
  pubkey: string;
  title: string;
  creator: string;
  version: number;
  canMigrate: boolean;
}

interface RowState {
  status: 'idle' | 'migrating' | 'done' | 'error';
  message?: string;
  signature?: string;
}

function authHeaders(): Record<string, string> {
  const token = typeof window !== 'undefined' ? window.localStorage.getItem(TOKEN_STORAGE_KEY) : null;
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (token) headers['Authorization'] = `Bearer ${token}`;
  return headers;
}

export default function MigrateMarketsPage() {
  const [markets, setMarkets] = useState<V1Market[]>([]);
  const [loading, setLoading] = useState(false);
  const [listError, setListError] = useState<string | null>(null);
  const [rowState, setRowState] = useState<Record<string, RowState>>({});
  const [bulkRunning, setBulkRunning] = useState(false);

  const fetchMarkets = useCallback(async () => {
    setLoading(true);
    setListError(null);
    try {
      const res = await fetch(`${API_URL}/api/admin/migrations/v1-markets`, {
        headers: authHeaders(),
      });
      const json = await res.json();
      if (!res.ok) {
        throw new Error(json?.error?.message || `HTTP ${res.status}`);
      }
      setMarkets(json.data || []);
    } catch (e: any) {
      setListError(e.message || String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchMarkets();
  }, [fetchMarkets]);

  const migrateOne = useCallback(async (pubkey: string) => {
    setRowState((prev) => ({ ...prev, [pubkey]: { status: 'migrating' } }));
    try {
      const res = await fetch(`${API_URL}/api/admin/migrations/migrate`, {
        method: 'POST',
        headers: authHeaders(),
        body: JSON.stringify({ marketPubkey: pubkey }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json?.error?.message || `HTTP ${res.status}`);
      setRowState((prev) => ({
        ...prev,
        [pubkey]: { status: 'done', signature: json.data?.signature },
      }));
      // remove from list (it's now v2)
      setMarkets((prev) => prev.filter((m) => m.pubkey !== pubkey));
    } catch (e: any) {
      setRowState((prev) => ({
        ...prev,
        [pubkey]: { status: 'error', message: e.message || String(e) },
      }));
    }
  }, []);

  const migrateAllEligible = useCallback(async () => {
    setBulkRunning(true);
    const eligible = markets.filter((m) => m.canMigrate);
    for (const m of eligible) {
      // eslint-disable-next-line no-await-in-loop
      await migrateOne(m.pubkey);
    }
    setBulkRunning(false);
  }, [markets, migrateOne]);

  const eligibleCount = markets.filter((m) => m.canMigrate).length;

  return (
    <AdminLayout
      title="Migrate Markets to v2"
      description="Backfill quote_mint / quote_decimals / version on pre-v2 market accounts"
    >
      <div className="max-w-5xl mx-auto space-y-6">
        <div className="rounded-xl border border-[#262626] bg-[#0f0f0f] p-5">
          <div className="flex items-start justify-between gap-4">
            <div>
              <h2 className="text-white font-semibold text-lg">Unmigrated markets</h2>
              <p className="text-[#737373] text-sm mt-1">
                Markets still on the pre-v2 layout need the new quote-token fields backfilled.
                The backend signs with the auto-keeper keypair and can only migrate markets it
                created. For markets created by other wallets, use the CLI migration script with
                that wallet&rsquo;s keypair.
              </p>
            </div>
            <div className="flex gap-2 shrink-0">
              <button
                onClick={fetchMarkets}
                disabled={loading || bulkRunning}
                className="px-3 py-2 text-sm rounded-lg bg-[#1a1a1a] border border-[#262626] text-white hover:bg-[#262626] disabled:opacity-50"
              >
                {loading ? 'Refreshing…' : 'Refresh'}
              </button>
              <button
                onClick={migrateAllEligible}
                disabled={bulkRunning || eligibleCount === 0}
                className="px-3 py-2 text-sm rounded-lg bg-white text-black font-medium hover:bg-white/90 disabled:opacity-50"
              >
                {bulkRunning ? 'Migrating…' : `Migrate all eligible (${eligibleCount})`}
              </button>
            </div>
          </div>

          {listError && (
            <div className="mt-4 p-3 rounded-lg bg-red-500/10 border border-red-500/20 text-red-300 text-sm">
              {listError}
            </div>
          )}
        </div>

        <div className="rounded-xl border border-[#262626] bg-[#0f0f0f] overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-[#1a1a1a] text-[#a3a3a3]">
              <tr>
                <th className="text-left font-medium px-4 py-3">Market</th>
                <th className="text-left font-medium px-4 py-3">Creator</th>
                <th className="text-left font-medium px-4 py-3">Version</th>
                <th className="text-right font-medium px-4 py-3">Action</th>
              </tr>
            </thead>
            <tbody>
              {!loading && markets.length === 0 && (
                <tr>
                  <td colSpan={4} className="px-4 py-8 text-center text-[#737373]">
                    {listError ? '—' : 'All markets are on v2. Nothing to migrate.'}
                  </td>
                </tr>
              )}
              {markets.map((m) => {
                const state = rowState[m.pubkey];
                const busy = state?.status === 'migrating';
                return (
                  <tr key={m.pubkey} className="border-t border-[#1a1a1a]">
                    <td className="px-4 py-3">
                      <div className="text-white font-medium line-clamp-1">{m.title || '(untitled)'}</div>
                      <div className="text-[#737373] font-mono text-xs mt-0.5">{m.pubkey}</div>
                    </td>
                    <td className="px-4 py-3 font-mono text-xs text-[#a3a3a3]">
                      {m.creator.slice(0, 6)}…{m.creator.slice(-6)}
                    </td>
                    <td className="px-4 py-3 text-[#a3a3a3]">v{m.version}</td>
                    <td className="px-4 py-3 text-right">
                      {state?.status === 'done' ? (
                        <span className="text-emerald-400 text-xs">
                          migrated · {state.signature?.slice(0, 8)}…
                        </span>
                      ) : state?.status === 'error' ? (
                        <div className="flex flex-col items-end gap-1">
                          <span className="text-red-400 text-xs">{state.message}</span>
                          <button
                            onClick={() => migrateOne(m.pubkey)}
                            className="px-2 py-1 text-xs rounded bg-[#1a1a1a] border border-[#262626] text-white hover:bg-[#262626]"
                          >
                            Retry
                          </button>
                        </div>
                      ) : (
                        <button
                          onClick={() => migrateOne(m.pubkey)}
                          disabled={busy || !m.canMigrate || bulkRunning}
                          title={!m.canMigrate ? 'Keeper is not the creator of this market — use the CLI script' : undefined}
                          className="px-3 py-1.5 text-xs rounded-lg bg-white text-black font-medium hover:bg-white/90 disabled:opacity-40 disabled:cursor-not-allowed"
                        >
                          {busy ? 'Migrating…' : 'Migrate'}
                        </button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </AdminLayout>
  );
}
