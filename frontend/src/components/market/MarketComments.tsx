import { useState, useRef, useEffect, useCallback } from 'react';
import Image from 'next/image';
import { useAuth } from '@/context/AuthContext';

const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001';

interface ApiComment {
  id: number;
  marketId: number;
  walletAddress: string;
  username: string | null;
  avatar: string | null;
  text: string;
  stars: number;
  starredByUser: boolean;
  createdAt: string;
}

interface Comment {
  id: number;
  user: string;
  position: string | null;
  time: string;
  text: string;
  stars: number;
  avatar: string | null;
  starredByUser: boolean;
}

interface MarketCommentsProps {
  marketId: string;
  comments?: Comment[];
}

function formatTimeAgo(dateStr: string): string {
  const now = Date.now();
  const date = new Date(dateStr).getTime();
  const diff = now - date;
  const minutes = Math.floor(diff / 60000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}d ago`;
  const months = Math.floor(days / 30);
  return `${months}mo ago`;
}

function shortenWallet(address: string): string {
  return `${address.slice(0, 4)}...${address.slice(-4)}`;
}

function mapApiComment(c: ApiComment): Comment {
  return {
    id: c.id,
    user: c.username || shortenWallet(c.walletAddress),
    position: null,
    time: formatTimeAgo(c.createdAt),
    text: c.text,
    stars: c.stars,
    avatar: c.avatar || null,
    starredByUser: c.starredByUser,
  };
}

export function MarketComments({ marketId, comments: externalComments }: MarketCommentsProps) {
  const { token, isAuthenticated } = useAuth();
  const [activeTab, setActiveTab] = useState('Comments');
  const [commentText, setCommentText] = useState('');
  const [openDropdownId, setOpenDropdownId] = useState<number | null>(null);
  const dropdownRefs = useRef<{ [key: number]: HTMLDivElement | null }>({});
  const [comments, setComments] = useState<Comment[]>(externalComments || []);
  const [starCounts, setStarCounts] = useState<{ [key: number]: number }>({});
  const [starredComments, setStarredComments] = useState<Set<number>>(new Set());
  const [loading, setLoading] = useState(false);
  const [posting, setPosting] = useState(false);

  const tabs = ['Comments'];
  // const tabs = ['Comments', 'Top Holders', 'Activity'];

  const authHeaders = useCallback((): Record<string, string> => {
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (token) headers['Authorization'] = `Bearer ${token}`;
    return headers;
  }, [token]);

  // Fetch comments from API
  const fetchComments = useCallback(async () => {
    if (externalComments) return; // skip fetch if comments are passed externally
    setLoading(true);
    try {
      const res = await fetch(`${API_BASE_URL}/api/comments/${marketId}`, {
        headers: authHeaders(),
      });
      if (!res.ok) throw new Error('Failed to fetch comments');
      const json = await res.json();
      if (json.success && json.data?.comments) {
        const mapped = json.data.comments.map(mapApiComment);
        setComments(mapped);

        const counts: { [key: number]: number } = {};
        const starred = new Set<number>();
        json.data.comments.forEach((c: ApiComment) => {
          counts[c.id] = c.stars;
          if (c.starredByUser) starred.add(c.id);
        });
        setStarCounts(counts);
        setStarredComments(starred);
      }
    } catch {
      // silently fail - comments are non-critical
    } finally {
      setLoading(false);
    }
  }, [marketId, authHeaders, externalComments]);

  useEffect(() => {
    fetchComments();
  }, [fetchComments]);

  // Sync external comments if provided
  useEffect(() => {
    if (externalComments) {
      setComments(externalComments);
      const counts: { [key: number]: number } = {};
      externalComments.forEach(c => {
        counts[c.id] = c.stars;
      });
      setStarCounts(counts);
    }
  }, [externalComments]);

  const handlePost = async () => {
    if (!commentText.trim() || !isAuthenticated || posting) return;

    setPosting(true);
    try {
      const res = await fetch(`${API_BASE_URL}/api/comments/${marketId}`, {
        method: 'POST',
        headers: authHeaders(),
        body: JSON.stringify({ text: commentText.trim() }),
      });
      if (!res.ok) throw new Error('Failed to post comment');
      const json = await res.json();
      if (json.success && json.data) {
        const newComment = mapApiComment(json.data);
        setComments(prev => [newComment, ...prev]);
        setStarCounts(prev => ({ ...prev, [newComment.id]: 0 }));
      }
      setCommentText('');
    } catch {
      // silently fail
    } finally {
      setPosting(false);
    }
  };

  const handleReport = async (commentId: number) => {
    setOpenDropdownId(null);
    if (!isAuthenticated) return;

    try {
      const res = await fetch(`${API_BASE_URL}/api/comments/${commentId}/report`, {
        method: 'POST',
        headers: authHeaders(),
      });
      if (res.ok) {
        // Remove reported comment from the list
        setComments(prev => prev.filter(c => c.id !== commentId));
      }
    } catch {
      // silently fail
    }
  };

  const handleStarClick = async (commentId: number) => {
    if (starredComments.has(commentId) || !isAuthenticated) return;

    // Optimistic update
    setStarCounts(prev => ({
      ...prev,
      [commentId]: (prev[commentId] || 0) + 1,
    }));
    setStarredComments(prev => new Set(prev).add(commentId));

    try {
      const res = await fetch(`${API_BASE_URL}/api/comments/${commentId}/star`, {
        method: 'POST',
        headers: authHeaders(),
      });
      if (!res.ok) {
        // Revert optimistic update
        setStarCounts(prev => ({
          ...prev,
          [commentId]: (prev[commentId] || 1) - 1,
        }));
        setStarredComments(prev => {
          const next = new Set(prev);
          next.delete(commentId);
          return next;
        });
      } else {
        const json = await res.json();
        if (json.stars !== undefined) {
          setStarCounts(prev => ({ ...prev, [commentId]: json.stars }));
        }
      }
    } catch {
      // Revert optimistic update
      setStarCounts(prev => ({
        ...prev,
        [commentId]: (prev[commentId] || 1) - 1,
      }));
      setStarredComments(prev => {
        const next = new Set(prev);
        next.delete(commentId);
        return next;
      });
    }
  };

  // Close dropdown when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (openDropdownId !== null) {
        const dropdownElement = dropdownRefs.current[openDropdownId];
        if (dropdownElement && !dropdownElement.contains(event.target as Node)) {
          setOpenDropdownId(null);
        }
      }
    };

    if (openDropdownId !== null) {
      document.addEventListener('mousedown', handleClickOutside);
    }

    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [openDropdownId]);

  return (
    <div className="mt-6">
      {/* Tabs */}
      <div className="flex items-center gap-6 mb-4 border-b border-[#262626]">
        {tabs.map((tab) => (
          <button
            key={tab}
            onClick={() => setActiveTab(tab)}
            className={`px-1 py-3 text-sm font-medium transition-colors border-b-2 -mb-px ${
              activeTab === tab
                ? 'text-white border-white'
                : 'text-gray-400 hover:text-white border-transparent'
            }`}
          >
            {tab}
          </button>
        ))}
      </div>

      {/* Comment Input */}
      <div className="flex items-center gap-3 mb-6">
        <input
          type="text"
          value={commentText}
          onChange={(e) => setCommentText(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && handlePost()}
          placeholder={isAuthenticated ? "Add a comment" : "Sign in to comment"}
          disabled={!isAuthenticated || posting}
          className="flex-1 px-4 py-3 bg-[#141414] rounded-lg text-white placeholder-gray-500 focus:outline-none focus:border-gray-500 disabled:opacity-50"
        />
        <button
          onClick={handlePost}
          disabled={!isAuthenticated || posting || !commentText.trim()}
          className="px-5 py-3 bg-[#262626] text-gray-300 font-medium rounded-lg hover:bg-[#333] transition-colors flex items-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {posting ? 'Posting...' : 'Post'}
          <div className="w-5 h-5 rounded-full bg-gray-600 flex items-center justify-center text-xs">+</div>
        </button>
      </div>

      {/* Comments List */}
      {loading && comments.length === 0 ? (
        <div className="space-y-5">
          {[1, 2, 3].map((i) => (
            <div key={i} className="flex gap-3 animate-pulse">
              <div className="w-10 h-10 rounded-full bg-[#262626] flex-shrink-0" />
              <div className="flex-1 space-y-2">
                <div className="flex items-center gap-2">
                  <div className="h-4 w-20 bg-[#262626] rounded" />
                  <div className="h-3 w-12 bg-[#262626] rounded" />
                </div>
                <div className="h-3 w-3/4 bg-[#262626] rounded" />
                <div className="h-3 w-10 bg-[#262626] rounded" />
              </div>
            </div>
          ))}
        </div>
      ) : comments.length === 0 ? (
        <div className="text-gray-500 text-sm text-center py-8">No comments yet. Be the first to comment!</div>
      ) : (
        <div className="space-y-5">
          {comments.map((comment) => (
            <div key={comment.id} className="flex gap-3">
              <div className="w-10 h-10 rounded-full bg-[#262626] flex-shrink-0 overflow-hidden">
                {comment.avatar ? (
                  <Image
                    src={comment.avatar}
                    alt={comment.user}
                    width={40}
                    height={40}
                    className="w-full h-full object-cover"
                  />
                ) : (
                  <div className="w-full h-full bg-gradient-to-br from-purple-500 to-pink-500"></div>
                )}
              </div>
              <div className="flex-1">
                <div className="flex items-center gap-2 mb-1">
                  <span className="text-white font-medium">{comment.user}</span>
                  {comment.position && (
                    <span className={`text-xs px-2 py-0.5 rounded ${
                      comment.position.includes('Yes')
                        ? 'bg-green-500/20 text-green-400'
                        : 'bg-red-500/20 text-red-400'
                    }`}>
                      {comment.position}
                    </span>
                  )}
                  <span className="text-gray-500 text-sm"> {comment.time}</span>
                </div>
                <p className="text-gray-300 text-sm mb-2">{comment.text}</p>
                <button
                  onClick={() => handleStarClick(comment.id)}
                  disabled={starredComments.has(comment.id) || !isAuthenticated}
                  className={`flex items-center gap-1 transition-colors ${
                    starredComments.has(comment.id)
                      ? 'text-yellow-400 cursor-not-allowed'
                      : !isAuthenticated
                        ? 'text-gray-600 cursor-not-allowed'
                        : 'text-gray-500 hover:text-gray-300'
                  }`}
                >
                  <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24">
                    <path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z" />
                  </svg>
                  <span className="text-xs">{starCounts[comment.id] || 0}</span>
                </button>
              </div>
              <div
                ref={(el) => { dropdownRefs.current[comment.id] = el; }}
                className="relative"
              >
                <button
                  onClick={() => setOpenDropdownId(openDropdownId === comment.id ? null : comment.id)}
                  className="text-gray-500 hover:text-gray-300 p-1 transition-colors"
                >
                  <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 5v.01M12 12v.01M12 19v.01M12 6a1 1 0 110-2 1 1 0 010 2zm0 7a1 1 0 110-2 1 1 0 010 2zm0 7a1 1 0 110-2 1 1 0 010 2z" />
                  </svg>
                </button>
                {openDropdownId === comment.id && (
                  <div className="absolute right-3 top-5 mt-1 w-40 bg-[#1a1a1a] border border-[#262626] rounded-lg shadow-xl z-50 overflow-hidden">
                    <button
                      onClick={() => handleReport(comment.id)}
                      className="w-full px-4 py-2.5 text-left text-sm text-gray-300 hover:bg-[#262626] transition-colors"
                    >
                      Report
                    </button>
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
