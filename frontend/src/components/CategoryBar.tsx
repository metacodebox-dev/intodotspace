import { useState, useRef, useEffect, useCallback } from 'react';

// Fire icon for All
const FireIcon = () => (
  <svg className="w-4 h-4" viewBox="0 0 24 24" fill="currentColor">
    <path d="M12 23C7.58 23 4 19.42 4 15C4 11.83 5.67 9.17 6.75 7.75C7.17 7.2 8 7.5 8 8.18V9.5C8 10.88 9.12 12 10.5 12C11.88 12 13 10.88 13 9.5V3.1C13 2.45 13.68 2.03 14.25 2.35C17.57 4.2 20 8.12 20 12.5C20 18.3 16.42 23 12 23ZM10 15C10 16.1 10.9 17 12 17C13.1 17 14 16.1 14 15C14 13.9 13.1 13 12 13C10.9 13 10 13.9 10 15Z"/>
  </svg>
);

// Arrow icon for Breakouts
const ArrowIcon = () => (
  <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
    <path d="M7 17L17 7M17 7H7M17 7V17" strokeLinecap="round" strokeLinejoin="round"/>
  </svg>
);

// Star icon for New
const StarIcon = () => (
  <svg className="w-4 h-4" viewBox="0 0 24 24" fill="currentColor">
    <path d="M12 2L15.09 8.26L22 9.27L17 14.14L18.18 21.02L12 17.77L5.82 21.02L7 14.14L2 9.27L8.91 8.26L12 2Z"/>
  </svg>
);

// Rocket icon for Space Markets
const RocketIcon = () => (
  <svg className="w-4 h-4" viewBox="0 0 24 24" fill="currentColor">
    <path d="M12 2.5c.55 0 1.5.5 3 2s2.5 3.5 2.5 6-1 4.5-2 5.5v4c0 .5-.5 1-1 1s-1-.5-1-1v-3h-3v3c0 .5-.5 1-1 1s-1-.5-1-1v-4c-1-1-2-3-2-5.5s1-4.5 2.5-6 2.45-2 3-2zm0 6a1.5 1.5 0 100 3 1.5 1.5 0 000-3zM5 16l-2 5 5-2-3-3zm14 0l-3 3 5 2-2-5z"/>
  </svg>
);

// Search icon
const SearchIcon = () => (
  <svg className="w-4 h-4 text-[#8F9090]" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
    <circle cx="11" cy="11" r="8"/>
    <path d="M21 21L16.65 16.65" strokeLinecap="round"/>
  </svg>
);

const filters = [
  { id: 'all', label: 'All', icon: FireIcon },
  { id: 'breakouts', label: 'Breakouts', icon: ArrowIcon },
  { id: 'new', label: 'New', icon: StarIcon },
  { id: 'space', label: 'Space Markets', icon: RocketIcon },
];

const categories = [
  { id: 'crypto', label: 'Crypto' },
  { id: 'politics', label: 'Politics' },
  { id: 'sports', label: 'Sports' },
  { id: 'technology', label: 'Technology' },
  { id: 'economics', label: 'Economics' },
  { id: 'culture', label: 'Culture' },
  // { id: 'other', label: 'Other' },
];

type FilterType = 'all' | 'breakouts' | 'new' | 'space' | null;
type CategoryType = string | null;

interface CategoryBarProps {
  onFilterChange?: (filter: FilterType) => void;
  onCategoryChange?: (category: CategoryType) => void;
  onSearch?: (query: string) => void;
}

export function CategoryBar({ onFilterChange, onCategoryChange, onSearch }: CategoryBarProps) {
  const [activeFilter, setActiveFilter] = useState<FilterType>('all');
  const [activeCategory, setActiveCategory] = useState<CategoryType>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const searchInputRef = useRef<HTMLInputElement>(null);

  
  // Sliding highlight state
  const [highlightStyle, setHighlightStyle] = useState({ left: 0, width: 0, opacity: 0 });
  const containerRef = useRef<HTMLDivElement>(null);
  const buttonRefs = useRef<Map<string, HTMLButtonElement>>(new Map());

  // Update highlight position
  const updateHighlight = useCallback(() => {
    const activeId = activeFilter || activeCategory;
    if (!activeId || !containerRef.current) {
      setHighlightStyle(prev => ({ ...prev, opacity: 0 }));
      return;
    }

    const button = buttonRefs.current.get(activeId);
    if (button && containerRef.current) {
      const containerRect = containerRef.current.getBoundingClientRect();
      const buttonRect = button.getBoundingClientRect();
      const scrollLeft = containerRef.current.scrollLeft;

      setHighlightStyle({
        left: buttonRect.left - containerRect.left + scrollLeft,
        width: buttonRect.width,
        opacity: 1,
      });
    }
  }, [activeFilter, activeCategory]);

  useEffect(() => {
  const handleKeyDown = (e: KeyboardEvent) => {
    // Ignore if user is typing in an input/textarea
    const target = e.target as HTMLElement;
    if (
      target.tagName === 'INPUT' ||
      target.tagName === 'TEXTAREA' ||
      target.isContentEditable
    ) {
      return;
    }

    if (e.key === '/') {
      e.preventDefault(); // stop "/" from typing
      searchInputRef.current?.focus();
    }
  };

  window.addEventListener('keydown', handleKeyDown);
  return () => window.removeEventListener('keydown', handleKeyDown);
}, []);


  useEffect(() => {
    updateHighlight();
    window.addEventListener('resize', updateHighlight);
    const container = containerRef.current;
    container?.addEventListener('scroll', updateHighlight);
    return () => {
      window.removeEventListener('resize', updateHighlight);
      container?.removeEventListener('scroll', updateHighlight);
    };
  }, [updateHighlight]);

  const setButtonRef = (id: string) => (el: HTMLButtonElement | null) => {
    if (el) {
      buttonRefs.current.set(id, el);
    }
  };

  const handleFilterClick = (filter: FilterType) => {
    setActiveFilter(filter);
    setActiveCategory(null);
    onFilterChange?.(filter);
  };

  const handleCategoryClick = (category: string) => {
    setActiveFilter(null);
    setActiveCategory(category);
    onCategoryChange?.(category);
  };

  const isActive = (id: string) => activeFilter === id || activeCategory === id;

  return (
    <div className="w-full mb-4">
      <div className="max-w-7xl mx-auto">
        <div className="flex flex-col-reverse lg:flex-row gap-2 lg:mt-0  items-center justify-between lg:h-12 h-auto">
          {/* Left side: Filters and Categories */}
          <div ref={containerRef} className="relative flex items-center gap-1 overflow-x-auto scrollbar-hide w-full" style={{ WebkitOverflowScrolling: 'touch' }}>
            {/* Sliding highlight background */}
            <div
              className="absolute top-1/2 -translate-y-1/2 h-8 bg-[#2a2a2a] rounded-md transition-all duration-300 ease-out"
              style={{
                left: highlightStyle.left,
                width: highlightStyle.width,
                opacity: highlightStyle.opacity,
              }}
            />

            {/* Filter buttons */}
            {filters.map((filter) => {
              const Icon = filter.icon;
              return (
                <button
                  key={filter.id}
                  ref={setButtonRef(filter.id)}
                  onClick={() => handleFilterClick(filter.id as FilterType)}
                  className={`relative z-10 flex items-center gap-1.5 px-2 py-1.5 rounded-md text-sm font-medium transition-colors duration-200 whitespace-nowrap flex-shrink-0 ${
                    isActive(filter.id)
                      ? 'text-white'
                      : 'text-[#888888] hover:text-white'
                  }`}
                >
                  <Icon />
                  <span>{filter.label}</span>
                </button>
              );
            })}

            {/* Separator */}
            <div className="w-px h-5 bg-[#333333] mx-2 flex-shrink-0" />

            {/* Category buttons */}
            {categories.map((cat) => (
              <button
                key={cat.id}
                ref={setButtonRef(cat.id)}
                onClick={() => handleCategoryClick(cat.id)}
                className={`relative z-10 px-3 py-1.5 rounded-md text-sm font-medium transition-colors duration-200 whitespace-nowrap flex-shrink-0 ${
                  isActive(cat.id)
                    ? 'text-white'
                    : 'text-[#888888] hover:text-white'
                }`}
              >
                {cat.label}
              </button>
            ))}
          </div>

          {/* Right side: Search */}
          <div className="relative w-full lg:w-auto">
            <div className="flex items-center bg-[#141414] border border-[#262626] rounded-lg px-3 py-1.5 gap-2 min-w-[280px] w-full lg:w-auto">
              <SearchIcon />
              <input
                type="text"
                ref={searchInputRef}
                placeholder="Search markets or profiles"
                value={searchQuery}
                onChange={(e) => {
                  setSearchQuery(e.target.value);
                  onSearch?.(e.target.value);
                }}
                className="bg-transparent text-sm text-white placeholder-[#8F9090] outline-none flex-1"
              />
              <span className="text-[#8F9090] text-sm bg-[#212121] rounded px-2 py-0.5">/</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

export default CategoryBar;
