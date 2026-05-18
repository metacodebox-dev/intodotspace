import { useState, useMemo } from "react";
import Image from "next/image";
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  ResponsiveContainer,
  Tooltip,
  CartesianGrid,
} from "recharts";
import { Market } from "@/types/market";
import { formatNumber } from "@/types/formateNumbers";

interface MarketPriceChartProps {
  market: Market;
  currentPrice: number; // Current price as percentage (e.g., 33 for 33%)
  isPortfolioChart?: boolean;
  totalPNL?: number; // Total PNL from all positions
  pnlLoading?: boolean; // Loading state for PNL
}

// Color palette for multi-outcome chart lines
const OUTCOME_COLORS = [
  "#4ade80", // green
  "#60a5fa", // blue
  "#f59e0b", // amber
  "#f472b6", // pink
  "#a78bfa", // purple
  "#fb923c", // orange
  "#2dd4bf", // teal
  "#e879f9", // fuchsia
  "#fbbf24", // yellow
  "#34d399", // emerald
];

// Get period config (shared between single and multi)
const getPeriodConfig = (period: string) => {
  let points = 20;
  let interval = 1;
  let dateFormat = (d: Date) =>
    d.toLocaleDateString("en-US", { month: "short", day: "numeric" });

  switch (period) {
    case "1H":
      points = 12;
      interval = 5;
      dateFormat = (d: Date) =>
        d.toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit" });
      break;
    case "1D":
      points = 24;
      interval = 60;
      dateFormat = (d: Date) =>
        d.toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit" });
      break;
    case "1W":
      points = 7;
      interval = 1;
      break;
    case "1M":
      points = 30;
      interval = 1;
      break;
    case "All":
    default:
      points = 20;
      interval = 3;
      break;
  }

  return { points, interval, dateFormat };
};

// Generate price history based on current price and time period
const generatePriceHistory = (currentPrice: number, period: string) => {
  const { points, interval, dateFormat } = getPeriodConfig(period);
  const data: { date: string; price: number }[] = [];
  const now = new Date();

  let price = currentPrice + (Math.random() - 0.5) * 20;
  const priceStep = (currentPrice - price) / points;

  for (let i = 0; i < points; i++) {
    const date = new Date(now);
    if (period === "1H" || period === "1D") {
      date.setMinutes(date.getMinutes() - (points - i) * interval);
    } else {
      date.setDate(date.getDate() - (points - i) * interval);
    }

    const noise = (Math.random() - 0.5) * 5;
    price = Math.max(1, Math.min(99, price + priceStep + noise));

    data.push({
      date: dateFormat(date),
      price: Math.round(price * 10) / 10,
    });
  }

  if (data.length > 0) {
    data[data.length - 1].price = currentPrice;
  }

  return data;
};

// Generate multi-outcome price history with shared date axis
const generateMultiOutcomePriceHistory = (
  outcomes: { label: string; price: number }[],
  period: string,
) => {
  const { points, interval, dateFormat } = getPeriodConfig(period);
  const now = new Date();
  const data: Record<string, string | number>[] = [];

  // Pre-generate price series for each outcome
  const series = outcomes.map((o) => {
    let price = o.price + (Math.random() - 0.5) * 20;
    const priceStep = (o.price - price) / points;
    const prices: number[] = [];

    for (let i = 0; i < points; i++) {
      const noise = (Math.random() - 0.5) * 5;
      price = Math.max(1, Math.min(99, price + priceStep + noise));
      prices.push(Math.round(price * 10) / 10);
    }
    // Ensure last point matches actual price
    prices[prices.length - 1] = o.price;
    return prices;
  });

  for (let i = 0; i < points; i++) {
    const date = new Date(now);
    if (period === "1H" || period === "1D") {
      date.setMinutes(date.getMinutes() - (points - i) * interval);
    } else {
      date.setDate(date.getDate() - (points - i) * interval);
    }

    const point: Record<string, string | number> = {
      date: dateFormat(date),
    };
    outcomes.forEach((o, idx) => {
      point[o.label] = series[idx][i];
    });
    data.push(point);
  }

  return data;
};

export function MarketPriceChart({
  market,
  currentPrice,
  isPortfolioChart = false,
  totalPNL = 0,
  pnlLoading = false,
}: MarketPriceChartProps) {
  const [chartPeriod, setChartPeriod] = useState("All");

  // Get period label based on selected period
  const getPeriodLabel = () => {
    switch (chartPeriod) {
      case "1H":
        return "Past Hour";
      case "1D":
        return "Past Day";
      case "1W":
        return "Past Week";
      case "1M":
        return "Past Month";
      case "All":
      default:
        return "All Time";
    }
  };

  const isMultiOutcome = market.isMultiOutcome && (market.outcomes?.length ?? 0) > 2;

  const outcomePrices = useMemo(
    () =>
      (market.outcomes ?? []).map((o) => ({
        label: o.label,
        price: Math.round((o.lastPrice || o.share_price || 5000) / 100),
      })),
    [market.outcomes],
  );

  const priceHistory = useMemo(
    () =>
      isMultiOutcome
        ? generateMultiOutcomePriceHistory(outcomePrices, chartPeriod)
        : generatePriceHistory(currentPrice, chartPeriod),
    [isMultiOutcome, outcomePrices, currentPrice, chartPeriod],
  );

  return (
    <div className="relative">
      {isPortfolioChart && (
        <>
          {/* Chart Footer */}
          <div className="flex items-start justify-between pt-2">
            <div className="flex flex-col items-start gap-1">
              <p className="text-sm font-semibold">Profit/Loss</p>
              <p
                className={`text-2xl font-normal tracking-wide ${totalPNL >= 0 ? "text-[#5CDB2A]" : "text-red-400"}`}
              >
                {pnlLoading
                  ? "..."
                  : `${totalPNL >= 0 ? "+" : ""}$${formatNumber(totalPNL.toFixed(2))}`}
              </p>
              <span className="text-xs text-[#909090]">{getPeriodLabel()}</span>
            </div>
            <div className="flex flex-col items-end gap-2.5 pb-6">
              <div className="flex items-center gap-1">
                {["1H", "1D", "1W", "1M", "All"].map((period) => (
                  <button
                    key={period}
                    onClick={() => setChartPeriod(period)}
                    className={`px-3 py-1.5 text-xs font-medium rounded-lg transition-colors ${
                      chartPeriod === period
                        ? "bg-white text-black"
                        : "text-gray-400 hover:text-white"
                    }`}
                  >
                    {period}
                  </button>
                ))}
              </div>
              <Image
                src="/assets/space-chart.svg"
                alt="space chart"
                width={100}
                height={100}
                className="w-26"
              />
            </div>
          </div>
        </>
      )}

       {/* Multi-outcome legend */}
      {isMultiOutcome && (
        <div className="flex flex-wrap gap-x-4 gap-y-1.5 px-2 pb-2">
          {outcomePrices.map((o, idx) => (
            <div key={o.label} className="flex items-center gap-1.5">
              <span
                className="inline-block w-2.5 h-2.5 rounded-full"
                style={{ backgroundColor: OUTCOME_COLORS[idx % OUTCOME_COLORS.length] }}
              />
              <span className="text-xs text-gray-400">{o.label}</span>
              <span className="text-xs text-white font-medium">{o.price}%</span>
            </div>
          ))}
        </div>
      )}

      <ResponsiveContainer width="100%" height={250}>
        <LineChart
          data={priceHistory}
          margin={{ top: 10, right: 0, left: 0, bottom: 10 }}
        >
          <CartesianGrid
            horizontal={true}
            vertical={false}
            strokeDasharray="3 3"
            stroke="#333"
          />
          <XAxis
            dataKey="date"
            axisLine={false}
            tickLine={false}
            tick={{ fill: "#666", fontSize: 11, dy: 10 }}
            interval="preserveStartEnd"
          />
          <YAxis
            orientation="right"
            domain={[0, 100]}
            axisLine={false}
            tickLine={false}
            tick={{ fill: "#666", fontSize: 11 }}
            tickFormatter={(v) => `${v}%`}
            ticks={[0, 20, 40, 60, 80, 100]}
            width={45}
          />
          <Tooltip
            contentStyle={{
              backgroundColor: "#1a1a1a",
              border: "1px solid #333",
              borderRadius: 8,
            }}
            labelStyle={{ color: "#fff" }}
            formatter={(value: number, name: string) => [
              `${value.toFixed(1)}%`,
              isMultiOutcome ? name : "Price",
            ]}
          />
          {isMultiOutcome ? (
            outcomePrices.map((o, idx) => (
              <Line
                key={o.label}
                type="monotone"
                dataKey={o.label}
                stroke={OUTCOME_COLORS[idx % OUTCOME_COLORS.length]}
                strokeWidth={2}
                dot={false}
                activeDot={{
                  r: 5,
                  fill: OUTCOME_COLORS[idx % OUTCOME_COLORS.length],
                  stroke: OUTCOME_COLORS[idx % OUTCOME_COLORS.length],
                  strokeWidth: 2,
                }}
              />
            ))
          ) : (
            <Line
              type="monotone"
              dataKey="price"
              stroke="#4ade80"
              strokeWidth={2}
              dot={false}
              activeDot={{
                r: 6,
                fill: "#4ade80",
                stroke: "#4ade80",
                strokeWidth: 2,
              }}
            />
          )}
        </LineChart>
      </ResponsiveContainer>

      {!isPortfolioChart && (
        <>
          {/* Chart Footer */}
          <div className="flex items-center justify-between pt-2 border-t border-[#262626]">
            <div className="items-center gap-4 lg:flex hidden">
              {/* <span className="text-white font-semibold">
            ${((market.total_volume || 0) / 1e6).toFixed(0)}M Volume
          </span> */}
              <div className="items-center gap-2 hidden lg:flex">
                <div className="relative group flex items-center transition-all duration-300 cursor-pointer hover:bg-[#262626]/50 p-2 gap-1 px-3 rounded-xl text-xs text-gray-300">
                  <div className="flex items-center gap-1">
                    <Image
                      src="/assets/usdc-trade.png"
                      alt="USDC"
                      width={100}
                      height={100}
                      className="w-5"
                    />
                    Earn USDC
                  </div>

                  {/* Tooltip */}
                  <div className="absolute -bottom-8 left-1/2 -translate-x-1/2 whitespace-nowrap opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none bg-[#1a1a1a] border border-[#262626] text-xs text-gray-300 px-2 py-1 rounded z-20">
                    Coming soon
                  </div>
                </div>

                <div className="relative group flex items-center transition-all duration-300 cursor-pointer hover:bg-[#262626]/50 p-2 gap-1 px-3 rounded-xl text-xs text-gray-300">
                  <Image
                    src="/assets/space-trade.png"
                    alt="SPACE"
                    width={100}
                    height={100}
                    className="w-5"
                  />
                  Earn SPC
                  {/* Tooltip */}
                  <div className="absolute -bottom-8 left-1/2 -translate-x-1/2 whitespace-nowrap opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none bg-[#1a1a1a] border border-[#262626] text-xs text-gray-300 px-2 py-1 rounded z-20">
                    Coming soon
                  </div>
                </div>
              </div>
            </div>
            <div className="flex items-center justify-between lg:justify-end gap-1 w-full lg:w-auto">
              {["1H", "1D", "1W", "1M", "All"].map((period) => (
                <button
                  key={period}
                  onClick={() => setChartPeriod(period)}
                  className={`px-3 py-1.5 text-xs font-medium rounded-lg transition-colors ${
                    chartPeriod === period
                      ? "bg-white text-black"
                      : "text-gray-400 hover:text-white"
                  }`}
                >
                  {period}
                </button>
              ))}
              <button className="p-2 hover:bg-[#262626] rounded-lg transition-colors ml-2">
                <svg
                  className="w-4 h-4 text-gray-400"
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z"
                  />
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"
                  />
                </svg>
              </button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
