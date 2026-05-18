export function MarketPageSkeleton() {
  return (
    <div className="animate-pulse">
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Left Column Skeleton */}
        <div className="lg:col-span-2 flex flex-col gap-4">
          {/* Market Header Skeleton */}
          <div className="flex items-center gap-4">
            <div className="w-20 h-20 rounded-xl bg-[#1a1a1a]"></div>
            <div className="flex-1">
              <div className="h-7 bg-[#1a1a1a] rounded-lg w-3/4 mb-2"></div>
              <div className="h-4 bg-[#1a1a1a] rounded w-1/2"></div>
            </div>
            <div className="w-8 h-8 rounded-lg bg-[#1a1a1a]"></div>
          </div>

          {/* Chance & Time Skeleton */}
          <div className="flex items-center justify-between">
            <div className="flex flex-col gap-2">
              <div className="flex items-center gap-3">
                <div className="h-6 w-32 bg-[#1a1a1a] rounded"></div>
                <div className="h-5 w-16 bg-[#1a1a1a] rounded"></div>
              </div>
              <div className="h-4 w-48 bg-[#1a1a1a] rounded"></div>
            </div>
            <div className="h-10 w-24 bg-[#1a1a1a] rounded-lg"></div>
          </div>

          {/* Chart Skeleton */}
          <div className="h-[250px] bg-[#1a1a1a] rounded-xl relative overflow-hidden">
            <div className="absolute inset-4 flex flex-col justify-between">
              {[0, 1, 2, 3, 4].map((i) => (
                <div key={i} className="h-px bg-[#262626] w-full"></div>
              ))}
            </div>
            <div className="absolute bottom-4 left-4 right-16 h-px bg-[#262626]"></div>
            <div className="absolute right-4 top-4 bottom-4 flex flex-col justify-between">
              {[0, 1, 2, 3, 4, 5].map((i) => (
                <div key={i} className="h-3 w-8 bg-[#262626] rounded"></div>
              ))}
            </div>
          </div>

          {/* Chart Footer Skeleton */}
          <div className="flex items-center justify-between pt-2 border-t border-[#262626]">
            <div className="flex items-center gap-4">
              <div className="h-5 w-24 bg-[#1a1a1a] rounded"></div>
              <div className="flex gap-2">
                <div className="h-5 w-20 bg-[#1a1a1a] rounded-full"></div>
                <div className="h-5 w-24 bg-[#1a1a1a] rounded-full"></div>
              </div>
            </div>
            <div className="flex gap-1">
              {[0, 1, 2, 3, 4].map((i) => (
                <div key={i} className="h-7 w-10 bg-[#1a1a1a] rounded-lg"></div>
              ))}
            </div>
          </div>

          {/* Collapsible Sections Skeleton */}
          <div className="space-y-2 mt-6">
            {[0, 1, 2].map((i) => (
              <div key={i} className="bg-[#141414] rounded-xl px-5 py-4 flex items-center justify-between">
                <div className="h-5 w-32 bg-[#1a1a1a] rounded"></div>
                <div className="h-5 w-5 bg-[#1a1a1a] rounded"></div>
              </div>
            ))}
          </div>

          {/* Comments Section Skeleton */}
          <div className="mt-6">
            <div className="flex items-center gap-6 mb-4 border-b border-[#262626] pb-3">
              {[0, 1, 2].map((i) => (
                <div key={i} className="h-4 w-20 bg-[#1a1a1a] rounded"></div>
              ))}
            </div>
            <div className="flex items-center gap-3 mb-6">
              <div className="flex-1 h-12 bg-[#141414] rounded-lg"></div>
              <div className="h-12 w-20 bg-[#262626] rounded-lg"></div>
            </div>
            <div className="space-y-5">
              {[0, 1, 2].map((i) => (
                <div key={i} className="flex gap-3">
                  <div className="w-10 h-10 rounded-full bg-[#1a1a1a]"></div>
                  <div className="flex-1">
                    <div className="flex items-center gap-2 mb-2">
                      <div className="h-4 w-20 bg-[#1a1a1a] rounded"></div>
                      <div className="h-4 w-16 bg-[#1a1a1a] rounded"></div>
                    </div>
                    <div className="h-4 w-3/4 bg-[#1a1a1a] rounded"></div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Right Column Skeleton */}
        <div className="space-y-4">
          {/* Trading Card Skeleton */}
          <div className="bg-[#141414] rounded-xl overflow-hidden">
            {/* Buy/Sell Tabs */}
            <div className="flex items-center justify-between px-4 py-3 border-b border-[#262626]">
              <div className="flex gap-4">
                <div className="h-5 w-12 bg-[#1a1a1a] rounded"></div>
                <div className="h-5 w-12 bg-[#1a1a1a] rounded"></div>
              </div>
              <div className="h-5 w-16 bg-[#1a1a1a] rounded"></div>
            </div>

            <div className="p-5 space-y-5">
              {/* Yes/No Buttons */}
              <div className="flex gap-3">
                <div className="flex-1 h-14 bg-[#1a1a1a] rounded-lg"></div>
                <div className="flex-1 h-14 bg-[#1a1a1a] rounded-lg"></div>
              </div>

              {/* Amount */}
              <div>
                <div className="h-3 w-16 bg-[#1a1a1a] rounded mb-2"></div>
                <div className="h-10 w-24 bg-[#1a1a1a] rounded"></div>
              </div>

              {/* Quick Amount Buttons */}
              <div className="flex gap-2">
                {[0, 1, 2, 3].map((i) => (
                  <div key={i} className="h-8 w-14 bg-[#1a1a1a] rounded-lg border border-[#262626]"></div>
                ))}
              </div>

              {/* Leverage */}
              <div>
                <div className="flex items-center justify-between mb-3">
                  <div className="h-4 w-16 bg-[#1a1a1a] rounded"></div>
                  <div className="h-5 w-10 bg-[#1a1a1a] rounded-full"></div>
                </div>
                <div className="flex items-center gap-3">
                  <div className="flex-1 h-5 bg-[#1a1a1a] rounded"></div>
                  <div className="h-5 w-8 bg-[#1a1a1a] rounded"></div>
                </div>
              </div>

              {/* Buy Button */}
              <div className="h-14 bg-[#1a1a1a] rounded-xl"></div>

              {/* Order Summary */}
              <div className="space-y-3">
                <div className="flex justify-between">
                  <div className="h-4 w-12 bg-[#1a1a1a] rounded"></div>
                  <div className="h-4 w-16 bg-[#1a1a1a] rounded"></div>
                </div>
                <div className="flex justify-between">
                  <div className="h-4 w-10 bg-[#1a1a1a] rounded"></div>
                  <div className="h-4 w-14 bg-[#1a1a1a] rounded"></div>
                </div>
              </div>

              {/* To Win Section */}
              <div className="border-t border-[#262626] pt-6">
                <div className="flex items-center justify-between">
                  <div>
                    <div className="h-4 w-14 bg-[#1a1a1a] rounded mb-1"></div>
                    <div className="h-3 w-24 bg-[#1a1a1a] rounded"></div>
                  </div>
                  <div className="h-8 w-20 bg-[#1a1a1a] rounded"></div>
                </div>
              </div>
            </div>
          </div>

          {/* Recommended Markets Skeleton */}
          <div className="overflow-hidden">
            <div className="flex border-b border-[#262626]">
              <div className="flex-1 h-10 flex items-center justify-center">
                <div className="h-4 w-24 bg-[#1a1a1a] rounded"></div>
              </div>
              <div className="flex-1 h-10 flex items-center justify-center">
                <div className="h-4 w-20 bg-[#1a1a1a] rounded"></div>
              </div>
            </div>
            <div className="p-4 space-y-3">
              {[0, 1, 2].map((i) => (
                <div key={i} className="flex items-center gap-3 p-2">
                  <div className="w-12 h-12 rounded-lg bg-[#1a1a1a]"></div>
                  <div className="flex-1 h-4 bg-[#1a1a1a] rounded"></div>
                  <div className="h-5 w-10 bg-[#1a1a1a] rounded"></div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
