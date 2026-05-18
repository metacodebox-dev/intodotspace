import Link from "next/link";

export function CompetitionsBanner() {
  return (
    <div
      className="relative w-full rounded-2xl overflow-hidden bg-cover bg-center"
      style={{ backgroundImage: "url('/assets/comp/comp-banner.png')" }}
    >
      <div className="relative z-10 px-8 py-10 md:py-14 max-w-2xl">
        <div className="flex items-center gap-2 mb-4">
          <h2 className="text-lg font-semibold text-white">Trading Competitions</h2>
          <div className="relative group">
            <svg
              className="w-5 h-5 text-white opacity-80 cursor-pointer"
              fill="currentColor"
              viewBox="0 0 20 20"
            >
              <path
                fillRule="evenodd"
                d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7-4a1 1 0 11-2 0 1 1 0 012 0zM9 9a1 1 0 000 2v3a1 1 0 001 1h1a1 1 0 100-2v-3a1 1 0 00-1-1H9z"
                clipRule="evenodd"
              />
            </svg>
            <div className="absolute left-full top-0 ml-2 w-64 px-4 py-3 rounded-lg bg-black border border-[#333] text-sm text-white opacity-0 pointer-events-none group-hover:opacity-100 group-hover:pointer-events-auto transition-opacity z-20">
              Compete by trading to earn points. Top traders on the leaderboard win rewards from the prize pool.
            </div>
          </div>
        </div>
        <p className="text-2xl md:text-3xl font-bold text-white leading-snug">
          Join campaigns, earn points, and compete for rewards.
        </p>
        <Link href='https://x.com/intodotspace/status/2040088822982025566' target="_blank" className="inline-block mt-6 px-8 py-3 rounded-lg bg-black text-white text-sm font-medium hover:bg-gray-900 transition-colors border border-[#333]">
          View Rules
        </Link>
      </div>
    </div>
  );
}
