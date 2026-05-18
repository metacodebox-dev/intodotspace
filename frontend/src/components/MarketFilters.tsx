import { useState } from 'react';

interface Props {
  category: string;
  onCategoryChange: (category: string) => void;
}

const categories = [
  { value: '', label: 'All Categories' },
  { value: 'crypto', label: 'Crypto' },
  { value: 'politics', label: 'Politics' },
  { value: 'sports', label: 'Sports' },
  { value: 'technology', label: 'Technology' },
  { value: 'economics', label: 'Economics' },
  { value: 'culture', label: 'Culture' },
];

export function MarketFilters({ category, onCategoryChange }: Props) {
  const [showFilters, setShowFilters] = useState(false);

  return (
    <div className="mb-6">
      {showFilters && (
        <div className="mb-4 bg-space-gray-800 rounded-xl p-4 border border-space-gray-700 animate-slide-up">
          <div>
            <label className="block text-sm font-semibold text-white mb-3">Category</label>
            <div className="flex flex-wrap gap-2">
              {categories.map((cat) => (
                <button
                  key={cat.value}
                  onClick={() => onCategoryChange(cat.value)}
                  className={`px-4 py-2 rounded-lg text-sm font-medium transition-all duration-200 ${
                    category === cat.value
                      ? 'bg-space-primary text-white'
                      : 'bg-space-gray-700 text-space-gray-300 hover:bg-space-gray-600'
                  }`}
                >
                  {cat.label}
                </button>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
