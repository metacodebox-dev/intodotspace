import { AdminLayout } from '@/components/AdminLayout';
import { useWallet } from '@solana/wallet-adapter-react';
import { isAdminWallet } from '@/utils/admin';
import { useAuth } from '@/context/AuthContext';
import { useState, useEffect, useCallback } from 'react';

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001';

interface CompetitionData {
  id: number;
  name: string;
  description: string | null;
  prizePool: string;
  rewardBreakdown: string | null;
  status: 'upcoming' | 'live' | 'ended';
  startDate: string;
  endDate: string;
  rewards: { rank: number; reward: string }[];
}

interface RewardRow {
  rank: number;
  reward: string;
}

const STATUS_COLORS: Record<string, string> = {
  upcoming: 'bg-yellow-500/20 text-yellow-400',
  live: 'bg-green-500/20 text-green-400',
  ended: 'bg-blue-500/20 text-blue-300',
};

export default function ManageCompetitions() {
  const { connected, publicKey } = useWallet();
  const isAdmin = isAdminWallet(connected, publicKey);
  const { token } = useAuth();

  const [competitions, setCompetitions] = useState<CompetitionData[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  // Form state
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [formData, setFormData] = useState<{
    name: string;
    description: string;
    prizePool: string;
    rewardBreakdown: string;
    status: 'upcoming' | 'live' | 'ended';
    startDate: string;
    endDate: string;
  }>({
    name: '',
    description: '',
    prizePool: '',
    rewardBreakdown: '',
    status: 'upcoming',
    startDate: '',
    endDate: '',
  });

  // Rewards config state
  const [rewardsCompId, setRewardsCompId] = useState<number | null>(null);
  const [rewardRows, setRewardRows] = useState<RewardRow[]>([]);

  const authHeaders = {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${token}`,
  };

  const fetchCompetitions = useCallback(async () => {
    try {
      const res = await fetch(`${API_URL}/api/competitions`);
      const data = await res.json();
      if (data.success) setCompetitions(data.data);
    } catch {
      setError('Failed to fetch competitions');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (isAdmin) fetchCompetitions();
  }, [isAdmin, fetchCompetitions]);

  const clearMessages = () => { setError(''); setSuccess(''); };

  const resetForm = () => {
    setFormData({ name: '', description: '', prizePool: '', rewardBreakdown: '', status: 'upcoming', startDate: '', endDate: '' });
    setEditingId(null);
    setShowForm(false);
  };

  const handleSubmit = async () => {
    clearMessages();
    if (!formData.name || !formData.prizePool || !formData.startDate || !formData.endDate) {
      setError('Name, prize pool, start date, and end date are required.');
      return;
    }

    try {
      const url = editingId
        ? `${API_URL}/api/competitions/${editingId}`
        : `${API_URL}/api/competitions`;

      const res = await fetch(url, {
        method: editingId ? 'PUT' : 'POST',
        headers: authHeaders,
        body: JSON.stringify(formData),
      });

      const data = await res.json();
      if (!res.ok) {
        setError(data.error?.message || 'Failed to save competition');
        return;
      }

      setSuccess(editingId ? 'Competition updated.' : 'Competition created.');
      resetForm();
      fetchCompetitions();
    } catch {
      setError('Network error.');
    }
  };

  const handleEdit = (comp: CompetitionData) => {
    setFormData({
      name: comp.name,
      description: comp.description || '',
      prizePool: comp.prizePool,
      rewardBreakdown: comp.rewardBreakdown || '',
      status: comp.status,
      startDate: new Date(comp.startDate).toISOString().slice(0, 16),
      endDate: new Date(comp.endDate).toISOString().slice(0, 16),
    });
    setEditingId(comp.id);
    setShowForm(true);
    clearMessages();
  };

  const handleDelete = async (id: number) => {
    clearMessages();
    try {
      const res = await fetch(`${API_URL}/api/competitions/${id}`, {
        method: 'DELETE',
        headers: authHeaders,
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error?.message || 'Failed to delete');
        return;
      }
      setSuccess('Competition deleted.');
      fetchCompetitions();
    } catch {
      setError('Network error.');
    }
  };

  const handleFinalize = async (id: number) => {
    clearMessages();
    try {
      const res = await fetch(`${API_URL}/api/competitions/${id}/finalize`, {
        method: 'POST',
        headers: authHeaders,
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error?.message || 'Failed to finalize');
        return;
      }
      setSuccess(`Competition finalized. ${data.data?.entriesStored || 0} leaderboard entries stored.`);
      fetchCompetitions();
    } catch {
      setError('Network error.');
    }
  };

  const openRewards = (comp: CompetitionData) => {
    setRewardsCompId(comp.id);
    setRewardRows(
      comp.rewards.length > 0
        ? comp.rewards.map(r => ({ rank: r.rank, reward: r.reward }))
        : [{ rank: 1, reward: '' }]
    );
    clearMessages();
  };

  const saveRewards = async () => {
    if (!rewardsCompId) return;
    clearMessages();

    const validRewards = rewardRows.filter(r => r.reward.trim());
    try {
      const res = await fetch(`${API_URL}/api/competitions/${rewardsCompId}/rewards`, {
        method: 'PUT',
        headers: authHeaders,
        body: JSON.stringify({ rewards: validRewards }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error?.message || 'Failed to save rewards');
        return;
      }
      setSuccess('Rewards saved.');
      setRewardsCompId(null);
      fetchCompetitions();
    } catch {
      setError('Network error.');
    }
  };

  if (!isAdmin) {
    return <AdminLayout title="Competitions" description="Manage competitions" />;
  }

  return (
    <AdminLayout title="Competitions" description="Create and manage trading competitions">
      <div className="max-w-4xl space-y-6">
        {/* Messages */}
        {error && (
          <div className="bg-red-500/10 border border-red-500/20 rounded-xl p-4 text-red-400 text-sm">
            {error}
          </div>
        )}
        {success && (
          <div className="bg-emerald-500/10 border border-emerald-500/20 rounded-xl p-4 text-emerald-400 text-sm">
            {success}
          </div>
        )}

        {/* Actions Bar */}
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-bold text-white">All Competitions</h2>
          <button
            onClick={() => { resetForm(); setShowForm(!showForm); clearMessages(); }}
            className="px-4 py-2 bg-white hover:bg-neutral-200 text-black font-semibold rounded-xl text-sm transition-colors"
          >
            {showForm ? 'Cancel' : '+ New Competition'}
          </button>
        </div>

        {/* Create / Edit Form */}
        {showForm && (
          <div className="bg-[#0a0a0a] rounded-2xl p-6 border border-[#1a1a1a] space-y-4">
            <h3 className="text-white font-semibold">{editingId ? 'Edit Competition' : 'Create Competition'}</h3>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="text-sm text-[#a3a3a3] mb-1 block">Name *</label>
                <input
                  type="text"
                  value={formData.name}
                  onChange={(e) => setFormData(f => ({ ...f, name: e.target.value }))}
                  className="w-full px-4 py-3 bg-[#111111] border border-[#262626] rounded-xl text-white text-sm focus:border-[#404040] outline-none"
                  placeholder="The Arena, Beta #1"
                />
              </div>
              <div>
                <label className="text-sm text-[#a3a3a3] mb-1 block">Prize Pool *</label>
                <input
                  type="text"
                  value={formData.prizePool}
                  onChange={(e) => setFormData(f => ({ ...f, prizePool: e.target.value }))}
                  className="w-full px-4 py-3 bg-[#111111] border border-[#262626] rounded-xl text-white text-sm focus:border-[#404040] outline-none"
                  placeholder="$1,000"
                />
              </div>
              <div>
                <label className="text-sm text-[#a3a3a3] mb-1 block">Reward Breakdown</label>
                <input
                  type="text"
                  value={formData.rewardBreakdown}
                  onChange={(e) => setFormData(f => ({ ...f, rewardBreakdown: e.target.value }))}
                  className="w-full px-4 py-3 bg-[#111111] border border-[#262626] rounded-xl text-white text-sm focus:border-[#404040] outline-none"
                  placeholder="$500 USDC, $500 SPACE"
                />
              </div>
              <div>
                <label className="text-sm text-[#a3a3a3] mb-1 block">Status</label>
                <select
                  value={formData.status}
                  onChange={(e) => setFormData(f => ({ ...f, status: e.target.value as any }))}
                  className="w-full px-4 py-3 bg-[#111111] border border-[#262626] rounded-xl text-white text-sm focus:border-[#404040] outline-none"
                >
                  <option value="upcoming">Upcoming</option>
                  <option value="live">Live</option>
                  <option value="ended">Ended</option>
                </select>
              </div>
              <div>
                <label className="text-sm text-[#a3a3a3] mb-1 block">Start Date *</label>
                <div className="flex gap-2">
                  <input
                    type="date"
                    value={formData.startDate.split('T')[0] || ''}
                    onChange={(e) => {
                      const time = formData.startDate.split('T')[1] || '18:00';
                      setFormData(f => ({ ...f, startDate: `${e.target.value}T${time}` }));
                    }}
                    className="flex-1 px-4 py-3 bg-[#111111] border border-[#262626] rounded-xl text-white text-sm focus:border-[#404040] outline-none [color-scheme:dark]"
                  />
                  <input
                    type="time"
                    value={formData.startDate.split('T')[1] || '18:00'}
                    onChange={(e) => {
                      const date = formData.startDate.split('T')[0] || '';
                      setFormData(f => ({ ...f, startDate: `${date}T${e.target.value}` }));
                    }}
                    className="w-28 px-3 py-3 bg-[#111111] border border-[#262626] rounded-xl text-white text-sm focus:border-[#404040] outline-none [color-scheme:dark]"
                  />
                </div>
                <p className="text-xs text-[#525252] mt-1">Time in UTC</p>
              </div>
              <div>
                <label className="text-sm text-[#a3a3a3] mb-1 block">End Date *</label>
                <div className="flex gap-2">
                  <input
                    type="date"
                    value={formData.endDate.split('T')[0] || ''}
                    onChange={(e) => {
                      const time = formData.endDate.split('T')[1] || '18:00';
                      setFormData(f => ({ ...f, endDate: `${e.target.value}T${time}` }));
                    }}
                    className="flex-1 px-4 py-3 bg-[#111111] border border-[#262626] rounded-xl text-white text-sm focus:border-[#404040] outline-none [color-scheme:dark]"
                  />
                  <input
                    type="time"
                    value={formData.endDate.split('T')[1] || '18:00'}
                    onChange={(e) => {
                      const date = formData.endDate.split('T')[0] || '';
                      setFormData(f => ({ ...f, endDate: `${date}T${e.target.value}` }));
                    }}
                    className="w-28 px-3 py-3 bg-[#111111] border border-[#262626] rounded-xl text-white text-sm focus:border-[#404040] outline-none [color-scheme:dark]"
                  />
                </div>
                <p className="text-xs text-[#525252] mt-1">Time in UTC</p>
              </div>
            </div>

            <div>
              <label className="text-sm text-[#a3a3a3] mb-1 block">Description</label>
              <textarea
                value={formData.description}
                onChange={(e) => setFormData(f => ({ ...f, description: e.target.value }))}
                rows={3}
                className="w-full px-4 py-3 bg-[#111111] border border-[#262626] rounded-xl text-white text-sm focus:border-[#404040] outline-none resize-none"
                placeholder="Competition description..."
              />
            </div>

            <button
              onClick={handleSubmit}
              className="px-6 py-3 bg-white hover:bg-neutral-200 text-black font-semibold rounded-xl text-sm transition-colors"
            >
              {editingId ? 'Update Competition' : 'Create Competition'}
            </button>
          </div>
        )}

        {/* Rewards Configuration Modal */}
        {rewardsCompId && (
          <div className="bg-[#0a0a0a] rounded-2xl p-6 border border-[#1a1a1a] space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="text-white font-semibold">
                Configure Rewards — {competitions.find(c => c.id === rewardsCompId)?.name}
              </h3>
              <button
                onClick={() => setRewardsCompId(null)}
                className="text-[#737373] hover:text-white text-sm"
              >
                Close
              </button>
            </div>

            <div className="space-y-2">
              {rewardRows.map((row, i) => (
                <div key={i} className="flex items-center gap-3">
                  <div className="w-20">
                    <input
                      type="number"
                      min={1}
                      value={row.rank}
                      onChange={(e) => {
                        const updated = [...rewardRows];
                        updated[i] = { ...updated[i], rank: parseInt(e.target.value) || 1 };
                        setRewardRows(updated);
                      }}
                      className="w-full px-3 py-2 bg-[#111111] border border-[#262626] rounded-lg text-white text-sm outline-none text-center"
                      placeholder="Rank"
                    />
                  </div>
                  <div className="flex-1">
                    <input
                      type="text"
                      value={row.reward}
                      onChange={(e) => {
                        const updated = [...rewardRows];
                        updated[i] = { ...updated[i], reward: e.target.value };
                        setRewardRows(updated);
                      }}
                      className="w-full px-3 py-2 bg-[#111111] border border-[#262626] rounded-lg text-white text-sm outline-none"
                      placeholder="e.g. $125 USDC + $125 SPACE"
                    />
                  </div>
                  <button
                    onClick={() => setRewardRows(rewardRows.filter((_, idx) => idx !== i))}
                    className="text-red-400 hover:text-red-300 text-sm px-2"
                  >
                    Remove
                  </button>
                </div>
              ))}
            </div>

            <div className="flex gap-3">
              <button
                onClick={() => setRewardRows([...rewardRows, { rank: rewardRows.length + 1, reward: '' }])}
                className="px-4 py-2 bg-[#171717] hover:bg-[#262626] text-white rounded-lg text-sm transition-colors"
              >
                + Add Rank
              </button>
              <button
                onClick={saveRewards}
                className="px-4 py-2 bg-white hover:bg-neutral-200 text-black font-semibold rounded-lg text-sm transition-colors"
              >
                Save Rewards
              </button>
            </div>
          </div>
        )}

        {/* Competition List */}
        {loading ? (
          <div className="space-y-3">
            {[1, 2, 3].map(i => (
              <div key={i} className="bg-[#0a0a0a] rounded-2xl p-5 border border-[#1a1a1a] h-24 animate-pulse" />
            ))}
          </div>
        ) : competitions.length === 0 ? (
          <div className="bg-[#0a0a0a] rounded-2xl p-10 border border-[#1a1a1a] text-center">
            <p className="text-[#737373] text-sm">No competitions yet. Create one to get started.</p>
          </div>
        ) : (
          <div className="space-y-3">
            {competitions.map((comp) => (
              <div key={comp.id} className="bg-[#0a0a0a] rounded-2xl p-5 border border-[#1a1a1a]">
                <div className="flex items-start justify-between gap-4">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1">
                      <h4 className="text-white font-semibold text-sm">{comp.name}</h4>
                      <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${STATUS_COLORS[comp.status]}`}>
                        {comp.status}
                      </span>
                    </div>
                    <p className="text-[#737373] text-xs">
                      {comp.prizePool} &middot; {new Date(comp.startDate).toLocaleDateString()} — {new Date(comp.endDate).toLocaleDateString()}
                      {comp.rewards.length > 0 && ` · ${comp.rewards.length} reward tiers`}
                    </p>
                  </div>

                  <div className="flex items-center gap-2 flex-shrink-0">
                    <button
                      onClick={() => openRewards(comp)}
                      className="px-3 py-1.5 bg-[#171717] hover:bg-[#262626] text-white rounded-lg text-xs transition-colors"
                    >
                      Rewards
                    </button>
                    <button
                      onClick={() => handleEdit(comp)}
                      className="px-3 py-1.5 bg-[#171717] hover:bg-[#262626] text-white rounded-lg text-xs transition-colors"
                    >
                      Edit
                    </button>
                    {comp.status === 'ended' && (
                      <button
                        onClick={() => handleFinalize(comp.id)}
                        className="px-3 py-1.5 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg text-xs transition-colors"
                      >
                        Finalize
                      </button>
                    )}
                    {comp.status === 'upcoming' && (
                      <button
                        onClick={() => handleDelete(comp.id)}
                        className="px-3 py-1.5 bg-red-600/20 hover:bg-red-600/30 text-red-400 rounded-lg text-xs transition-colors"
                      >
                        Delete
                      </button>
                    )}
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </AdminLayout>
  );
}
