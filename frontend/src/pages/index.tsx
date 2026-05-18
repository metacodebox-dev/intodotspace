import { useState, useEffect, useRef, useCallback } from "react";
import Head from "next/head";
import { Layout } from "@/components/Layout";
import { MarketList } from "@/components/MarketList";
import { CategoryBar } from "@/components/CategoryBar";
import { useMarketsWebSocket } from "@/hooks/useMarketsWebSocket";
import Image from "next/image";
import Link from "next/link";

export default function Home() {
  const [category, setCategory] = useState<string>("");
  const [quoteSymbol, setQuoteSymbol] = useState<string>("");
  const [searchQuery, setSearchQuery] = useState<string>("");
  const [debouncedSearch, setDebouncedSearch] = useState<string>("");

  // Debounce search input
  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedSearch(searchQuery);
    }, 300);
    return () => clearTimeout(timer);
  }, [searchQuery]);

  const { markets, loading, loadingMore, error, hasMore, loadMore } = useMarketsWebSocket({
    category,
    search: debouncedSearch,
    quoteSymbol,
  });

  // Infinite scroll via IntersectionObserver
  const loadMoreRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!loadMoreRef.current || !hasMore || loadingMore || loading) return;

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting) {
          loadMore();
        }
      },
      { threshold: 0.1 }
    );

    observer.observe(loadMoreRef.current);
    return () => observer.disconnect();
  }, [hasMore, loadingMore, loading, loadMore]);

  const handleCategoryChange = (newCategory: string | null) => {
    setCategory(newCategory || "");
    setQuoteSymbol("");
  };

  const handleFilterChange = (filter: "all" | "breakouts" | "new" | "space" | null) => {
    setCategory("");
    // The "space" filter is really a quote-token filter that lives in the
    // filters row; all others clear any active quote filter.
    setQuoteSymbol(filter === "space" ? "SPACE" : "");
  };

  const handleSearch = (query: string) => {
    setSearchQuery(query);
  };

  return (
    <>
      <Head>
        <title>Space - 10x Prediction Markets on Solana</title>
        <meta name="description" content="10x Prediction Markets  on Solana" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <link rel="icon" href="/favicon.ico" />
      </Head>

      <Layout>
        {/* Category Bar - Below Navbar */}
        <CategoryBar
          onFilterChange={handleFilterChange}
          onCategoryChange={handleCategoryChange}
          onSearch={handleSearch}
        />

        {/* Markets Section */}
        <div className="mb-20 md:mb-12">
          {loading && (
            <div className="animate-pulse">
              {/* Market cards grid skeleton - matches MarketList layout */}
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-5">
                {Array.from({ length: 12 }).map((_, index) => (
                  <div
                    key={index}
                    className="bg-[#141414] rounded-2xl p-3 border border-[#262626]"
                  >
                    {/* Header: Icon + Title + Progress */}
                    <div className="flex items-start gap-1">
                      {/* Category icon */}
                      <div className="w-10 h-10 rounded-xl bg-[#262626] flex-shrink-0"></div>
                      {/* Title */}
                      <div className="ml-1 flex-1">
                        <div className="h-4 w-full bg-[#262626] rounded mb-2"></div>
                        <div className="h-4 w-3/4 bg-[#1F1F1F] rounded"></div>
                      </div>
                      {/* Circular progress placeholder */}
                      <div className="w-[72px] h-[65px] flex items-center justify-center ml-2 mr-1">
                        <div className="w-14 h-14 rounded-full border-4 border-[#262626] border-t-[#1F1F1F]"></div>
                      </div>
                    </div>

                    {/* Yes/No Buttons */}
                    <div className="flex gap-1 mb-4 mt-3">
                      <div className="flex-1 py-5 rounded-xl bg-[#262626]"></div>
                      <div className="flex-1 py-5 rounded-xl bg-[#262626]"></div>
                    </div>

                    {/* Footer: Volume + Bookmark */}
                    <div className="flex items-center justify-between">
                      <div className="h-4 w-24 bg-[#1F1F1F] rounded"></div>
                      <div className="w-6 h-6 bg-[#1F1F1F] rounded"></div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {error && (
            <div className="bg-red-50 border border-red-200 rounded-lg p-4">
              <p className="text-red-600">Error: {error}</p>
            </div>
          )}

          {!loading && !error && <MarketList markets={markets} />}

          {/* Infinite scroll trigger */}
          {!loading && hasMore && (
            <div ref={loadMoreRef} className="flex justify-center py-8">
              {loadingMore ? (
                <div className="flex items-center gap-2">
                  <div className="w-4 h-4 border-2 border-[#262626] border-t-white rounded-full animate-spin" />
                  <span className="text-sm text-space-gray-400">Loading more markets...</span>
                </div>
              ) : (
                <button
                  onClick={loadMore}
                  className="text-sm text-space-gray-400 hover:text-white transition-colors"
                >
                  Load more
                </button>
              )}
            </div>
          )}
        </div>
      </Layout>
      <div className="fixed lg:flex hidden z-50 w-full bg-[#0E0E0E] border-y border-[#191919] h-8 items-center bottom-0 py-0.5">
        <div className="max-w-7xl flex items-center justify-between gap-3 mx-auto px-4 sm:px-6 lg:px-8 w-full">
          <div className="text-xs text-space-gray-400 flex items-center gap-1.5">
            {" "}
            <p className="h-1.5 w-1.5 rounded-full bg-[#51C026] animate-pulse"></p>{" "}
            Beta Live
          </div>

          <div className="flex items-center gap-3 h-6">
            <Link
              href="https://docs.into.space/en/concepts/how-it-works"
              target="_blank"
              className="flex items-center gap-1.5 hover:opacity-80 transition-opacity"
            >
              <Image
                src="/assets/home/docs.svg"
                alt="Docs"
                width={100}
                height={100}
                className="w-4"
              />
              <span className="text-xs text-white">Docs</span>
            </Link>
            <div className="border-r border-[#191919] h-full" />
            <Link
              href="https://docs.into.space/en/resources/support"
              target="_blank"
              className="flex items-center gap-1.5 hover:opacity-80 transition-opacity"
            >
              <Image
                src="/assets/home/support.svg"
                alt="Support"
                width={100}
                height={100}
                className="w-4"
              />
              <span className="text-xs text-white">Support</span>
            </Link>
            <div className="border-r border-[#191919] h-full" />


          {/* Privacy Policy */}
            <Link
              href="https://docs.into.space/en/resources/privacy"
              target="_blank"
              className="flex items-center gap-1.5 hover:opacity-80 transition-opacity text-xs"
            >
              Privacy
            </Link>

            {/* Terms of Service */}
            <Link
              href="https://docs.into.space/en/resources/tos"
              target="_blank"
              className="flex items-center gap-1.5 hover:opacity-80 transition-opacity text-xs"
            >
              Terms
            </Link>
 <div className="border-r border-[#191919] h-full" />
             <Link
              href="https://x.com/intodotspace"
              target="_blank"
              className="hover:opacity-80 transition-opacity"
            >
              <Image
                src="/assets/home/twitter.svg"
                alt="Twitter"
                width={100}
                height={100}
                className="w-4"
              />
            </Link>

            <Link
              href="https://t.me/spacechat"
              target="_blank"
              className="hover:opacity-80 transition-opacity"
            >
              <Image
                src="/assets/home/tg.svg"
                alt="Telegram"
                width={100}
                height={100}
                className="w-4"
              />
            </Link>
          </div>
        </div>
      </div>
    </>
  );
}
