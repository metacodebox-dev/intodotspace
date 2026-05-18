import { createContext, useContext, useState, useEffect, useCallback, ReactNode } from 'react';

const STORAGE_KEY = 'space_bookmarks';

interface BookmarksContextType {
  bookmarks: Set<string>;
  toggle: (marketId: string) => void;
  isBookmarked: (marketId: string) => boolean;
}

const BookmarksContext = createContext<BookmarksContextType>({
  bookmarks: new Set(),
  toggle: () => {},
  isBookmarked: () => false,
});

export function BookmarksProvider({ children }: { children: ReactNode }) {
  const [bookmarks, setBookmarks] = useState<Set<string>>(new Set());

  // Load from localStorage on mount
  useEffect(() => {
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      if (stored) {
        setBookmarks(new Set(JSON.parse(stored)));
      }
    } catch {}
  }, []);

  // Persist to localStorage
  const persist = (next: Set<string>) => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify([...next]));
  };

  const toggle = useCallback((marketId: string) => {
    setBookmarks((prev) => {
      const next = new Set(prev);
      if (next.has(marketId)) {
        next.delete(marketId);
      } else {
        next.add(marketId);
      }
      persist(next);
      return next;
    });
  }, []);

  const isBookmarked = useCallback((marketId: string) => {
    return bookmarks.has(marketId);
  }, [bookmarks]);

  return (
    <BookmarksContext.Provider value={{ bookmarks, toggle, isBookmarked }}>
      {children}
    </BookmarksContext.Provider>
  );
}

export const useBookmarks = () => useContext(BookmarksContext);
