import { ReactNode, useEffect, useState } from 'react';
import Image from 'next/image';

function useAnimatedValue(from: number, to: number, durationMs: number, loop = true) {
  const [value, setValue] = useState(from);
  useEffect(() => {
    let raf: number;
    let start: number | null = null;
    let forward = true;
    const animate = (ts: number) => {
      if (!start) start = ts;
      const elapsed = ts - start;
      const progress = Math.min(elapsed / durationMs, 1);
      const eased = progress < 0.5 ? 2 * progress * progress : 1 - Math.pow(-2 * progress + 2, 2) / 2;
      setValue(forward ? from + (to - from) * eased : to - (to - from) * eased);
      if (progress < 1) {
        raf = requestAnimationFrame(animate);
      } else if (loop) {
        forward = !forward;
        start = null;
        setTimeout(() => { raf = requestAnimationFrame(animate); }, 1200);
      }
    };
    raf = requestAnimationFrame(animate);
    return () => cancelAnimationFrame(raf);
  }, [from, to, durationMs, loop]);
  return value;
}

// ─────────────────────────────────────────────
// HOW TO BUY
// ─────────────────────────────────────────────

function AnimatedCursor({ targetX, targetY, clicking }: { targetX: number; targetY: number; clicking: boolean }) {
  return null;
}

interface CursorStep { x: number; y: number; click?: boolean; delay: number }

function useCursorSequence(steps: CursorStep[]) {
  const [pos, setPos] = useState({ x: steps[0]?.x ?? 50, y: steps[0]?.y ?? 50 });
  const [clicking, setClicking] = useState(false);
  const [stepIndex, setStepIndex] = useState(0);

  useEffect(() => {
    let i = 0;
    let timeout: ReturnType<typeof setTimeout>;
    const run = () => {
      const step = steps[i];
      setPos({ x: step.x, y: step.y });
      setStepIndex(i);
      if (step.click) {
        setTimeout(() => setClicking(true), Math.max(0, step.delay - 300));
        setTimeout(() => setClicking(false), step.delay - 50);
      } else {
        setClicking(false);
      }
      timeout = setTimeout(() => { i = (i + 1) % steps.length; run(); }, step.delay);
    };
    run();
    return () => clearTimeout(timeout);
  }, []);

  return { pos, clicking, stepIndex };
}

function ConnectWalletMock() {
  const { pos, clicking, stepIndex } = useCursorSequence([
    { x: 90, y: 50, delay: 2000 },            // hover Connect Wallet
    { x: 90, y: 50, click: true, delay: 500 }, // click Connect Wallet
    { x: 90, y: 50, delay: 1500 },            // Connecting...
    { x: 90, y: 50, delay: 1200 },            // hover Sign In
    { x: 90, y: 50, click: true, delay: 500 }, // click Sign In
    { x: 95, y: 50, delay: 3500 },            // authenticated, rest near avatar
  ]);

  const showConnect = stepIndex <= 1;
  const showConnecting = stepIndex === 2;
  const showSignIn = stepIndex === 3 || stepIndex === 4;
  const isAuthenticated = stepIndex >= 5;

  return (
    <div className="bg-space-dark rounded-xl overflow-hidden border border-space-gray-800 relative">
      <div className="px-6">
        <div className="flex items-center justify-end h-16 gap-4">
          {/* Stats - only when authenticated */}
          <div className={`flex items-center text-sm transition-all duration-700 overflow-hidden ${isAuthenticated ? 'max-w-[500px] opacity-100' : 'max-w-0 opacity-0'}`}>
            <div className="flex flex-col items-end border-r border-space-gray-400/20 pr-4 pl-3 whitespace-nowrap">
              <span className="text-space-gray-400 text-xs font-[500]">PORTFOLIO</span>
              <span className="text-space-success font-[500] text-base">$2,491</span>
            </div>
            <div className="flex flex-col items-end border-r border-space-gray-400/20 pr-4 pl-3 whitespace-nowrap">
              <span className="text-space-gray-400 text-xs font-[500]">POINTS</span>
              <span className="text-white font-[500] text-base">4,000</span>
            </div>
            <div className="flex items-center gap-2 border-r border-space-gray-400/20 pr-4 pl-3 whitespace-nowrap">
              <div className="flex flex-col items-end">
                <span className="text-space-gray-400 text-xs font-[500]">RANK</span>
                <span className="text-white font-[500] text-base">Iron</span>
              </div>
            </div>
          </div>

          {/* Deposit - only when authenticated */}
          <div className={`transition-all duration-700 overflow-hidden ${isAuthenticated ? 'opacity-100 max-w-[100px]' : 'opacity-0 max-w-0'}`}>
            <button className="px-4 py-2 bg-white hover:bg-space-gray-100 text-black text-sm font-semibold rounded-lg transition-colors whitespace-nowrap">
              Deposit
            </button>
          </div>

          {/* Connect Wallet button */}
          {showConnect && (
            <button className={`px-4 py-2 bg-white text-black text-sm font-semibold rounded-lg transition-all flex items-center gap-2 ${clicking && stepIndex === 1 ? 'scale-95 bg-gray-200' : ''}`}>
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101m-.758-4.899a4 4 0 005.656 0l4-4a4 4 0 00-5.656-5.656l-1.1 1.1" />
              </svg>
              <span>Connect Wallet</span>
            </button>
          )}

          {/* Connecting spinner */}
          {showConnecting && (
            <button className="px-4 py-2 bg-white text-black text-sm font-semibold rounded-lg flex items-center gap-2">
              <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
              </svg>
              <span>Connecting...</span>
            </button>
          )}

          {/* Sign In button */}
          {showSignIn && (
            <button className={`px-4 py-2 bg-white text-black text-sm font-semibold rounded-lg transition-all flex items-center gap-2 ${clicking && stepIndex === 4 ? 'scale-95 bg-gray-200' : ''}`}>
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 16l-4-4m0 0l4-4m-4 4h14m-5 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h7a3 3 0 013 3v1" />
              </svg>
              <span>Sign In</span>
            </button>
          )}

          {/* Profile avatar */}
          {isAuthenticated && (
            <button className="w-10 h-10 rounded-md bg-space-gray-100 hover:bg-space-gray-200 transition-colors flex items-center justify-center overflow-hidden">
              <span className="text-sm font-semibold text-black">A</span>
            </button>
          )}
        </div>
      </div>

      <AnimatedCursor targetX={pos.x} targetY={pos.y} clicking={clicking} />
    </div>
  );
}

function MockCircularProgress({ percentage }: { percentage: number }) {
  const size = 72;
  const height = 65;
  const center = size / 2;
  const radius = 28;
  const strokeWidth = 5;
  const totalSweepDeg = 180;
  const gapDeg = 16;
  const positivePercent = Math.max(0, Math.min(100, percentage));
  const negativePercent = 100 - positivePercent;
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const getPoint = (angleDeg: number) => ({
    x: center + radius * Math.cos(toRad(angleDeg)),
    y: center - radius * Math.sin(toRad(angleDeg)),
  });
  const createArcPath = (fromAngle: number, toAngle: number) => {
    if (Math.abs(fromAngle - toAngle) < 1) return '';
    const start = getPoint(fromAngle);
    const end = getPoint(toAngle);
    let sweep = fromAngle - toAngle;
    if (sweep < 0) sweep += 360;
    const largeArc = sweep > 180 ? 1 : 0;
    return `M ${start.x} ${start.y} A ${radius} ${radius} 0 ${largeArc} 1 ${end.x} ${end.y}`;
  };
  const positiveSweep = (positivePercent / 100) * (totalSweepDeg - gapDeg);
  const positiveStartAngle = 180;
  const positiveEndAngle = positiveStartAngle - positiveSweep;
  const positivePath = positivePercent > 0 ? createArcPath(positiveStartAngle, positiveEndAngle) : '';
  const negativeSweep = (negativePercent / 100) * (totalSweepDeg - gapDeg);
  const negativeEndAngle = 0;
  const negativeStartAngle = negativeEndAngle + negativeSweep;
  const negativePath = negativePercent > 0 ? createArcPath(negativeStartAngle, negativeEndAngle) : '';
  return (
    <div className="flex flex-col justify-center items-end w-[72px] gap-1 ml-2 mr-1">
      <svg width={size} height={height} viewBox={`0 0 ${size} ${size}`}>
        {negativePath && <path d={negativePath} fill="none" stroke="#2a2a2a" strokeWidth={strokeWidth} strokeLinecap="round" />}
        {positivePath && <path d={positivePath} fill="none" stroke="#6CBE45" strokeWidth={strokeWidth} strokeLinecap="round" />}
        <text x={center} y={center - 2} textAnchor="middle" dominantBaseline="middle" fill="white" fontSize="15" fontWeight="700" fontFamily="Inter, system-ui, sans-serif">{percentage}%</text>
      </svg>
    </div>
  );
}

const mockMarketsByCategory: Record<string, { title: string; yesLabel: string; noLabel: string; pct: number; volume: string }[]> = {
  All: [
    { title: 'US recession by end of...', yesLabel: 'Yes', noLabel: 'No', pct: 63, volume: '$2M' },
    { title: 'GTA 6 launch postponed...', yesLabel: 'Yes', noLabel: 'No', pct: 42, volume: '$1M' },
  ],
  Crypto: [
    { title: 'Will BTC hit $100K?', yesLabel: 'Yes', noLabel: 'No', pct: 65, volume: '$3M' },
    { title: 'ETH flips BTC market...', yesLabel: 'Yes', noLabel: 'No', pct: 12, volume: '$1.2M' },
  ],
  Politics: [
    { title: 'US election winner 2028...', yesLabel: 'Yes', noLabel: 'No', pct: 51, volume: '$5M' },
    { title: 'Fed rate cut before Jul...', yesLabel: 'Yes', noLabel: 'No', pct: 38, volume: '$2.1M' },
  ],
  Sports: [
    { title: 'Lakers win NBA 2026?', yesLabel: 'Yes', noLabel: 'No', pct: 18, volume: '$1.5M' },
    { title: 'Messi wins Ballon d\'Or...', yesLabel: 'Yes', noLabel: 'No', pct: 25, volume: '$920K' },
  ],
  Tech: [
    { title: 'Apple launches foldable...', yesLabel: 'Yes', noLabel: 'No', pct: 33, volume: '$1.8M' },
    { title: 'GPT-5 released in 2026?', yesLabel: 'Yes', noLabel: 'No', pct: 72, volume: '$2.3M' },
  ],
};

function FindMarketMock() {
  const categories = ['All', 'Crypto', 'Politics', 'Sports', 'Tech'];
  const catX = [8, 20, 35, 50, 62];
  const cursorSteps: CursorStep[] = categories.flatMap((_, i) => [
    { x: catX[i], y: 6, delay: 600 },
    { x: catX[i], y: 6, click: true, delay: 500 },
    { x: 30, y: 40, delay: 1800 },
  ]);
  const { pos, clicking, stepIndex } = useCursorSequence(cursorSteps);
  const active = Math.floor(stepIndex / 3) % categories.length;
  const currentMarkets = mockMarketsByCategory[categories[active]];
  return (
    <div className="bg-[#0E0E0E] rounded-xl overflow-hidden p-4 relative">
      {/* Category filter - matches index.tsx filter bar */}
      <div className="flex gap-1.5 mb-4">
        {categories.map((c, i) => (
          <span key={c} className={`px-3 py-1.5 rounded-lg text-[11px] font-medium whitespace-nowrap transition-all duration-300 cursor-pointer ${
            i === active ? 'bg-white text-black' : 'bg-[#262626] text-[#909090]'
          }`}>{c}</span>
        ))}
      </div>
      {/* Market cards - exact clone of MarketList.tsx */}
      <div className="grid grid-cols-2 gap-3">
        {currentMarkets.map((m) => (
          <div key={m.title} className="bg-[#141414] flex flex-col justify-between rounded-2xl p-3 border border-[#262626] hover:border-[#3a3a3a] transition-all duration-200 h-[200px]">
            {/* Header: Icon + Title + CircularProgress */}
            <div className="flex items-start justify-between gap-1">
              <div className="flex items-center gap-1">
                <div className="w-10 h-10 rounded-xl bg-space-gray-400 flex items-center justify-center flex-shrink-0" />
                <div className="ml-1">
                  <h3 className="text-sm font-semibold text-white leading-tight">
                    {m.title.length > 22 ? m.title.slice(0, 22) + '...' : m.title}
                  </h3>
                </div>
              </div>
              <MockCircularProgress percentage={m.pct} />
            </div>
            {/* Yes/No Buttons */}
            <div className="flex gap-1 mb-4">
              <button className="flex-1 py-5 rounded-xl bg-[#51C02614] transition-colors">
                <span className="text-space-success text-base font-medium">{m.yesLabel}</span>
              </button>
              <button className="flex-1 py-5 rounded-xl bg-[#ED422814] transition-colors">
                <span className="text-space-danger text-base font-medium">{m.noLabel}</span>
              </button>
            </div>
            {/* Footer: Volume + Bookmark */}
            <div className="flex items-center justify-between">
              <p className="text-[#909090] text-sm font-medium">{m.volume} Volume</p>
              <svg className="w-5 h-5 text-[#4a4a4a]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M17.593 3.322c1.1.128 1.907 1.077 1.907 2.185V21L12 17.25 4.5 21V5.507c0-1.108.806-2.057 1.907-2.185a48.507 48.507 0 0111.186 0z" />
              </svg>
            </div>
          </div>
        ))}
      </div>
      <AnimatedCursor targetX={pos.x} targetY={pos.y} clicking={clicking} />
    </div>
  );
}

function PlaceTradeMock() {
  const { pos, clicking, stepIndex } = useCursorSequence([
    { x: 25, y: 22, delay: 1000 },        // move to YES button
    { x: 25, y: 22, click: true, delay: 500 }, // click YES
    { x: 50, y: 62, delay: 1200 },        // move to Buy button
    { x: 50, y: 62, click: true, delay: 500 }, // click Buy
    { x: 50, y: 80, delay: 3000 },        // rest on To Win
  ]);
  const bought = stepIndex >= 4;
  const outcomeId = 0;
  return (
    <div className="bg-[#141414] rounded-xl overflow-hidden relative">
      {/* Buy/Sell + Market tabs */}
      <div className="flex items-center justify-between border-b border-[#262626]">
        <div className="flex px-4">
          <button className="px-4 py-3 text-sm font-semibold text-white border-b-2 border-white">Buy</button>
          <button className="px-4 py-3 text-sm font-semibold text-[#909090]">Sell</button>
        </div>
        <div className="px-4 py-2 mr-2 font-semibold text-sm text-[#909090] flex items-center gap-1">
          Market
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" /></svg>
        </div>
      </div>
      <div className="p-5 space-y-5">
        {/* Balance */}
        <div className="flex justify-between items-center text-sm p-3 bg-[#1a1a1a] rounded-lg">
          <span className="text-gray-400">USDC Balance</span>
          <span className="text-white font-semibold">$500.00</span>
        </div>
        {/* YES/NO buttons */}
        <div className="flex gap-3">
          <button onClick={() => setOutcomeId(0)} className={`flex-1 py-4 rounded-lg text-sm font-semibold transition-all ${outcomeId === 0 ? 'bg-[#5CDB2A] text-white' : 'bg-[#5cdb2a1c] text-[#5CDB2A]'}`}>
            Yes 65¢
          </button>
          <button onClick={() => setOutcomeId(1)} className={`flex-1 py-4 rounded-lg text-sm font-semibold transition-all ${outcomeId === 1 ? 'bg-[#ed4228] text-white' : 'bg-[#ED422814] text-[#ed4228]'}`}>
            No 35¢
          </button>
        </div>
        {/* Amount */}
        <div>
          <label className="text-xs text-[#909090] capitalize tracking-wide">Amount</label>
          <div className="flex items-baseline gap-1 mt-1">
            <span className="text-4xl font-bold text-white">100</span>
          </div>
          <p className="text-xs text-[#606060] mt-1">153 shares @ 65¢ per share</p>
        </div>
        {/* Quick amounts */}
        <div className="flex gap-2">
          {['+1', '+20', '+100', 'MAX'].map(v => (
            <button key={v} className="px-3 py-1.5 border border-[#3B3B3B] text-white text-sm font-medium rounded-lg transition-colors hover:bg-[#262626]">{v}</button>
          ))}
        </div>
        {/* Action button */}
        <button className={`w-full py-4 font-semibold rounded-xl transition-all duration-500 flex items-center justify-center gap-2 ${
          bought ? 'bg-green-500/10 border border-green-500/30 text-green-400' : 'bg-[#ffffff] hover:bg-[#ebebeb] text-black'
        }`}>
          {bought ? (
            <>
              <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5" /></svg>
              Order Placed
            </>
          ) : 'Buy YES'}
        </button>
        {/* To win */}
        <div className="border-t border-[#262626] pt-6">
          <div className="flex items-center justify-between">
            <div className="flex flex-col">
              <p className="text-sm text-[#5CDB2A] font-medium">Potential Profit (Yes)</p>
              <p className="text-sm text-[#A3A3A3]">Entry Price 65.00¢</p>
            </div>
            <p className="text-2xl font-bold text-[#5CDB2A]">$53.85</p>
          </div>
        </div>
      </div>
      <AnimatedCursor targetX={pos.x} targetY={pos.y} clicking={clicking} />
    </div>
  );
}

function PricingMock() {
  const prob = useAnimatedValue(40, 80, 5000);
  const priceCents = prob;
  return (
    <div className="bg-[#141414] rounded-xl overflow-hidden p-5">
      <div className="flex gap-3 mb-5">
        <div className={`flex-1 py-4 rounded-lg text-sm font-semibold text-center transition-all ${prob > 50 ? 'bg-[#5CDB2A] text-white' : 'bg-[#5cdb2a1c] text-[#5CDB2A]'}`}>
          Yes {Math.round(priceCents)}¢
        </div>
        <div className={`flex-1 py-4 rounded-lg text-sm font-semibold text-center transition-all ${prob <= 50 ? 'bg-[#ed4228] text-white' : 'bg-[#ED422814] text-[#ed4228]'}`}>
          No {Math.round(100 - priceCents)}¢
        </div>
      </div>
      {/* Summary rows */}
      <div className="space-y-3">
        <div className="flex justify-between text-sm">
          <span className="text-gray-500">You pay per share</span>
          <span className="text-white font-semibold">${(priceCents / 100).toFixed(2)}</span>
        </div>
        <div className="flex justify-between text-sm">
          <span className="text-gray-500">If correct, each share pays</span>
          <span className="text-white font-semibold">$1.00</span>
        </div>
        <div className="flex justify-between text-sm">
          <span className="text-gray-500">Potential profit per share</span>
          <span className="text-[#5CDB2A] font-semibold">+${(1 - priceCents / 100).toFixed(2)}</span>
        </div>
      </div>
      <div className="border-t border-[#262626] pt-4 mt-4">
        <div className="flex items-center justify-between">
          <p className="text-sm text-[#5CDB2A] font-medium">Potential Profit</p>
          <p className="text-2xl font-bold text-[#5CDB2A]">+{Math.round((1 - priceCents / 100) * 10000) / 100}%</p>
        </div>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────
// LEVERAGE
// ─────────────────────────────────────────────

function LeveragePanelShell({ lev, children, showCursor = true }: { lev: number; children?: ReactNode; showCursor?: boolean }) {
  const priceCents = 65;
  const shares = (100 * lev / (priceCents / 100));
  const positionValue = shares * (priceCents / 100);
  const margin = 100;
  const borrowed = margin * (lev - 1);
  const hasMarginFloor = lev > 5;
  const actualMargin = hasMarginFloor ? positionValue * 0.2 : margin;
  const toWin = (shares * 1 - actualMargin).toFixed(2);
  const sliderX = 8 + ((lev - 1) / 9) * 58;
  return (
    <div className="bg-[#141414] rounded-xl overflow-hidden relative">
      {/* Buy/Sell + Market tabs */}
      <div className="flex items-center justify-between border-b border-[#262626]">
        <div className="flex px-4">
          <button className="px-4 py-3 text-sm font-semibold text-white border-b-2 border-white">Buy</button>
          <button className="px-4 py-3 text-sm font-semibold text-[#909090]">Sell</button>
        </div>
        <div className="px-4 py-2 mr-2 font-semibold text-sm text-[#909090] flex items-center gap-1">
          Market
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" /></svg>
        </div>
      </div>
      <div className="p-5 space-y-5">
        {/* Balance */}
        <div className="flex justify-between items-center text-sm p-3 bg-[#1a1a1a] rounded-lg">
          <span className="text-gray-400">USDC Balance</span>
          <span className="text-white font-semibold">$500.00</span>
        </div>
        {/* YES/NO buttons */}
        <div className="flex gap-3">
          <button className="flex-1 py-4 rounded-lg text-sm font-semibold bg-[#5CDB2A] text-white">Yes 65¢</button>
          <button className="flex-1 py-4 rounded-lg text-sm font-semibold bg-[#ED422814] text-[#ed4228]">No 35¢</button>
        </div>
        {/* Amount */}
        <div>
          <label className="text-xs text-[#909090] capitalize tracking-wide">Amount</label>
          <div className="flex items-baseline gap-1 mt-1">
            <span className="text-4xl font-bold text-white">100</span>
          </div>
          <p className="text-xs text-[#606060] mt-1">{Math.floor(shares).toLocaleString()} shares @ {priceCents}¢ per share</p>
        </div>
        {/* Quick amounts */}
        <div className="flex gap-2">
          {['+1', '+20', '+100', 'MAX'].map(v => (
            <button key={v} className="px-3 py-1.5 border border-[#3B3B3B] text-white text-sm font-medium rounded-lg transition-colors hover:bg-[#262626]">{v}</button>
          ))}
        </div>
        {/* Leverage */}
        <div>
          <div className="flex items-center justify-between mb-3">
            <label className="text-sm text-[#A3A3A3]">Leverage</label>
            <button className="w-10 h-5 rounded-full transition-colors relative bg-[#5CDB2A]">
              <div className="absolute top-0.5 w-4 h-4 bg-white rounded-full transition-all left-5" />
            </button>
          </div>
          <div className="flex items-center gap-3">
            <div className="flex items-center justify-between gap-0.5 relative w-full cursor-pointer select-none">
              {[...Array(30)].map((_, i) => {
                const filledDots = Math.round(((lev - 1) / 9) * 30);
                return <div key={i} className={`w-1 h-5 rounded-full transition-all duration-300 ${i < filledDots ? 'bg-[#fffffd]' : 'bg-[#3B3B3B]'}`} />;
              })}
              <div
                className="z-10 w-16 absolute transition-all duration-300"
                style={{ left: `calc(${((lev - 1) / 9) * 100}% - 30px)` }}
              >
                <Image
                  src="/assets/toggle-market.png"
                  alt="Progress"
                  width={1000}
                  height={1000}
                  className="select-none pointer-events-none h-18 w-auto shrink-0"
                  draggable={false}
                />
              </div>
            </div>
            <div className="flex items-center min-w-[50px]">
              <span className="w-6 text-white font-semibold text-right">{lev}</span>
              <span className="text-white font-semibold">x</span>
            </div>
          </div>
        </div>
        {/* Action button */}
        <button className="w-full py-4 font-semibold rounded-xl bg-[#ffffff] hover:bg-[#ebebeb] text-black transition-colors flex items-center justify-center gap-2">
          Buy YES
        </button>
        {/* Order Summary */}
        <div className="space-y-3">
          <div className="flex justify-between text-sm">
            <span className="text-gray-500">Shares</span>
            <span className="text-white font-semibold">{shares.toFixed(2)}</span>
          </div>
          <div className="flex justify-between text-sm">
            <span className="text-gray-500">Position Value</span>
            <span className="text-white font-semibold">${positionValue.toFixed(2)}</span>
          </div>
          <div className="flex justify-between text-sm">
            <span className="text-gray-500">Margin Required</span>
            <span className={`font-semibold ${hasMarginFloor ? 'text-orange-400' : 'text-white'}`}>
              ${actualMargin.toFixed(2)}
            </span>
          </div>
          {hasMarginFloor && (
            <div className="p-2 bg-orange-500/10 border border-orange-500/20 rounded-lg">
              <p className="text-xs text-orange-400">
                On-chain 20% initial margin floor applies at {lev}x leverage.
                Effective leverage: 5x. Wallet will be charged ${actualMargin.toFixed(2)} instead of ${margin.toFixed(2)}.
              </p>
            </div>
          )}
          {borrowed > 0 && (
            <div className="flex justify-between text-sm">
              <span className="text-gray-500">Borrowed (from vault)</span>
              <span className="text-yellow-400 font-semibold">${borrowed.toFixed(2)}</span>
            </div>
          )}
        </div>
        {/* To Win */}
        <div className="border-t border-[#262626] pt-6">
          <div className="flex items-center justify-between">
            <div className="flex flex-col">
              <p className="text-sm text-[#5CDB2A] font-medium">Potential Profit (Yes)</p>
              <p className="text-sm text-[#A3A3A3]">Entry Price {priceCents}.00¢</p>
            </div>
            <p className="text-2xl font-bold text-[#5CDB2A]">${toWin}</p>
          </div>
        </div>
        {children}
      </div>
      {showCursor && <AnimatedCursor targetX={sliderX} targetY={52} clicking={false} />}
    </div>
  );
}

function LeverageExplainMock() {
  const [lev, setLev] = useState(1);
  useEffect(() => { const vals = [1, 2, 3, 5]; let i = 0; const t = setInterval(() => { i = (i + 1) % vals.length; setLev(vals[i]); }, 2000); return () => clearInterval(t); }, []);
  return <LeveragePanelShell lev={lev} />;
}

function LeverageSliderMock() {
  const [lev, setLev] = useState(2);
  useEffect(() => { const t = setInterval(() => setLev(l => l >= 10 ? 2 : l + 1), 1500); return () => clearInterval(t); }, []);
  return <LeveragePanelShell lev={lev} />;
}

function MarginMock() {
  const [lev, setLev] = useState(3);
  useEffect(() => { const vals = [3, 5, 7, 10]; let i = 0; const t = setInterval(() => { i = (i + 1) % vals.length; setLev(vals[i]); }, 2500); return () => clearInterval(t); }, []);
  return <LeveragePanelShell lev={lev} />;
}

function BestPracticesMock() {
  const [check, setCheck] = useState(0);
  useEffect(() => { const t = setInterval(() => setCheck(c => (c + 1) % 4), 1200); return () => clearInterval(t); }, []);
  const tips = ['Start with 2x leverage', 'Monitor liquidation price', 'Never risk more than you can afford'];
  return (
    <div className="bg-[#141414] rounded-xl overflow-hidden p-5">
      <div className="space-y-2">
        {tips.map((tip, i) => (
          <div key={i} className={`flex items-center gap-3 p-3 rounded-lg transition-all duration-500 ${i < check ? 'bg-green-500/10 border border-green-500/30' : 'bg-[#1a1a1a]'}`}>
            <div className={`w-5 h-5 rounded-full flex items-center justify-center flex-shrink-0 transition-all duration-500 ${i < check ? 'bg-[#5CDB2A]' : 'bg-[#262626]'}`}>
              {i < check && <svg className="w-3 h-3 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}><path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5" /></svg>}
            </div>
            <span className={`text-sm ${i < check ? 'text-green-400' : 'text-gray-400'}`}>{tip}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────
// LIMIT ORDERS
// ─────────────────────────────────────────────

function LimitOrderTabsMock() {
  const { pos, clicking, stepIndex } = useCursorSequence([
    { x: 85, y: 18, delay: 1200 },
    { x: 85, y: 18, click: true, delay: 500 },
    { x: 50, y: 60, delay: 2000 },
    { x: 85, y: 18, delay: 1200 },
    { x: 85, y: 18, click: true, delay: 500 },
    { x: 50, y: 60, delay: 2000 },
  ]);
  const tab = stepIndex >= 2 && stepIndex < 5 ? 'limit' as const : 'market' as const;
  return (
    <div className="bg-[#141414] rounded-xl overflow-hidden relative">
      <div className="flex items-center justify-between border-b border-[#262626]">
        <div className="flex px-4">
          <button className="px-4 py-3 text-sm font-semibold text-white border-b-2 border-white">Buy</button>
          <button className="px-4 py-3 text-sm font-semibold text-[#909090]">Sell</button>
        </div>
        <button className="px-4 py-2 mr-2 font-semibold text-sm flex items-center gap-1 transition-all duration-300" style={{ color: tab === 'limit' ? '#fff' : '#909090' }}>
          {tab === 'market' ? 'Market' : 'Limit'}
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" /></svg>
        </button>
      </div>
      <div className="p-5">
        <p className="text-xs text-[#606060]">
          {tab === 'market' ? 'Market orders execute instantly at the best available price.' : 'Limit orders let you set a specific price. Your order waits until matched.'}
        </p>
      </div>
      <AnimatedCursor targetX={pos.x} targetY={pos.y} clicking={clicking} />
    </div>
  );
}

function LimitPriceMock() {
  return (
    <div className="bg-[#141414] rounded-xl overflow-hidden">
      <div className="flex items-center justify-between border-b border-[#262626]">
        <div className="flex px-4">
          <button className="px-4 py-3 text-sm font-semibold text-white border-b-2 border-white">Buy</button>
          <button className="px-4 py-3 text-sm font-semibold text-[#909090]">Sell</button>
        </div>
        <div className="px-4 py-2 mr-2 font-semibold text-sm text-white flex items-center gap-1">
          Limit
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" /></svg>
        </div>
      </div>
      <div className="p-5 space-y-5">
        <div className="flex gap-3">
          <button className="flex-1 py-4 rounded-lg text-sm font-semibold bg-[#5CDB2A] text-white">Yes 65¢</button>
          <button className="flex-1 py-4 rounded-lg text-sm font-semibold bg-[#ED422814] text-[#ed4228]">No 35¢</button>
        </div>
        <div>
          <label className="text-xs text-[#909090] capitalize tracking-wide">Limit Price (Cents)</label>
          <div className="flex items-baseline gap-1 mt-1">
            <span className="text-2xl font-bold text-white">45</span>
            <span className="text-2xl font-bold text-[#909090]">¢</span>
          </div>
          <p className="text-xs text-[#606060] mt-1">Current: 65.00¢</p>
        </div>
        <div>
          <label className="text-xs text-[#909090] capitalize tracking-wide">Shares</label>
          <div className="flex items-baseline gap-1 mt-1">
            <span className="text-4xl font-bold text-white">111</span>
          </div>
          <p className="text-xs text-[#606060] mt-1">$49.95 @ 45¢ per share</p>
        </div>
        <div className="flex gap-2">
          {['+1', '+20', '+100', 'MAX'].map(v => (
            <button key={v} className="px-3 py-1.5 border border-[#3B3B3B] text-white text-sm font-medium rounded-lg">{v}</button>
          ))}
        </div>
        <button className="w-full py-4 font-semibold rounded-xl bg-[#ffffff] text-black">Buy YES</button>
      </div>
    </div>
  );
}

function OrderFillMock() {
  const price = useAnimatedValue(6500, 4300, 5000);
  const filled = price <= 4500;
  return (
    <div className="bg-[#141414] rounded-xl overflow-hidden p-5 space-y-4">
      <div className="flex justify-between items-center text-sm p-3 bg-[#1a1a1a] rounded-lg">
        <span className="text-gray-400">Order Status</span>
        <span className={`font-semibold ${filled ? 'text-green-400' : 'text-yellow-400'}`}>{filled ? 'Filled' : 'Pending'}</span>
      </div>
      <div className="space-y-3">
        <div className="flex justify-between text-sm">
          <span className="text-gray-500">Your Limit</span>
          <span className="text-white font-semibold">45.00¢</span>
        </div>
        <div className="flex justify-between text-sm">
          <span className="text-gray-500">Market Price</span>
          <span className={`font-semibold ${filled ? 'text-[#5CDB2A]' : 'text-white'}`}>{(price / 100).toFixed(2)}¢</span>
        </div>
      </div>
      {filled ? (
        <div className="p-3 bg-green-500/10 border border-green-500/30 rounded-xl">
          <p className="text-sm text-green-400">Order filled! 111 shares purchased at 45¢</p>
        </div>
      ) : (
        <div className="p-3 bg-yellow-500/10 border border-yellow-500/30 rounded-xl">
          <p className="text-sm text-yellow-400">Waiting for price to reach your limit...</p>
        </div>
      )}
    </div>
  );
}

function OpenOrdersMock() {
  const { pos, clicking, stepIndex } = useCursorSequence([
    { x: 50, y: 30, delay: 1500 },
    { x: 85, y: 78, delay: 800 },
    { x: 85, y: 78, click: true, delay: 500 },
    { x: 50, y: 30, delay: 3000 },
  ]);
  const cancelled = stepIndex >= 3;
  return (
    <div className="bg-[#141414] rounded-xl overflow-hidden p-5 space-y-4 relative">
      <div className="flex justify-between items-center">
        <span className="text-white text-sm font-semibold">Open Orders</span>
        <span className="text-xs text-[#909090]">{cancelled ? 1 : 2} active</span>
      </div>
      <div className="space-y-2">
        {[
          { market: 'BTC > $100K', side: 'Buy', price: '45¢', shares: '111' },
          { market: 'ETH > $5K', side: 'Buy', price: '30¢', shares: '83' },
        ].map((o, i) => (
          <div key={i} className={`flex items-center justify-between p-3 bg-[#1a1a1a] rounded-lg transition-all duration-500 ${
            i === 1 && cancelled ? 'opacity-30' : ''
          }`}>
            <div>
              <p className="text-sm text-white font-medium">{o.market}</p>
              <p className="text-xs text-[#606060]">{o.side} {o.shares} shares @ {o.price}</p>
            </div>
            <button className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-all ${
              i === 1 && cancelled
                ? 'bg-red-500/10 text-red-400 border border-red-500/30'
                : 'border border-[#3B3B3B] text-[#909090] hover:bg-[#262626]'
            }`}>
              {i === 1 && cancelled ? 'Cancelled' : 'Cancel'}
            </button>
          </div>
        ))}
      </div>
      <AnimatedCursor targetX={pos.x} targetY={pos.y} clicking={clicking} />
    </div>
  );
}

// ─────────────────────────────────────────────
// ORDER BOOK
// ─────────────────────────────────────────────

function OrderBookVisualMock() {
  const bids = [
    { price: 6200, size: 850 },
    { price: 6000, size: 620 },
    { price: 5800, size: 430 },
    { price: 5500, size: 210 },
  ];
  const asks = [
    { price: 6300, size: 780 },
    { price: 6500, size: 540 },
    { price: 6800, size: 350 },
    { price: 7200, size: 150 },
  ];
  const maxSize = Math.max(...bids.map(b => b.size), ...asks.map(a => a.size));
  return (
    <div className="bg-space-gray-800 rounded-xl border border-space-gray-700 p-6">
      <div className="flex items-center justify-between mb-6">
        <h2 className="text-xl font-bold text-white">Order Book</h2>
        <div className="flex items-center space-x-4 text-sm">
          <div><span className="text-space-gray-400">Current Price: </span><span className="font-semibold text-white">62.50¢</span></div>
          <div><span className="text-space-gray-400">Spread: </span><span className="font-semibold text-space-primary">1.00¢</span></div>
        </div>
      </div>
      <div className="grid grid-cols-2 gap-6">
        <div>
          <div className="flex items-center justify-between mb-3 px-2 pb-2 border-b border-space-gray-700">
            <span className="text-xs font-semibold text-space-danger uppercase tracking-wide">Sell Orders</span>
            <div className="flex space-x-4 text-xs text-space-gray-400"><span>Price</span><span>Size</span></div>
          </div>
          <div className="space-y-0.5">
            {asks.map((ask, i) => (
              <div key={i} className="flex items-center justify-between px-3 py-2 rounded hover:bg-space-gray-700/50 relative transition-colors">
                <div className="absolute left-0 top-0 bottom-0 bg-space-danger/10 rounded" style={{ width: `${(ask.size / maxSize) * 100}%` }} />
                <div className="flex items-center justify-between w-full relative z-10">
                  <span className="text-sm font-medium text-space-danger">{(ask.price / 100).toFixed(2)}¢</span>
                  <span className="text-sm text-space-gray-300 font-mono">{ask.size}</span>
                </div>
              </div>
            ))}
          </div>
        </div>
        <div>
          <div className="flex items-center justify-between mb-3 px-2 pb-2 border-b border-space-gray-700">
            <span className="text-xs font-semibold text-space-success uppercase tracking-wide">Buy Orders</span>
            <div className="flex space-x-4 text-xs text-space-gray-400"><span>Price</span><span>Size</span></div>
          </div>
          <div className="space-y-0.5">
            {bids.map((bid, i) => (
              <div key={i} className="flex items-center justify-between px-3 py-2 rounded hover:bg-space-gray-700/50 relative transition-colors">
                <div className="absolute right-0 top-0 bottom-0 bg-space-success/10 rounded" style={{ width: `${(bid.size / maxSize) * 100}%` }} />
                <div className="flex items-center justify-between w-full relative z-10">
                  <span className="text-sm font-medium text-space-success">{(bid.price / 100).toFixed(2)}¢</span>
                  <span className="text-sm text-space-gray-300 font-mono">{bid.size}</span>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

function OrderBookReadMock() {
  const [highlight, setHighlight] = useState(0);
  useEffect(() => { const t = setInterval(() => setHighlight(h => (h + 1) % 3), 2500); return () => clearInterval(t); }, []);
  const labels = ['Best bid — highest buy price', 'Spread — gap between best bid & ask', 'Best ask — lowest sell price'];
  return (
    <div className="bg-space-gray-800 rounded-xl border border-space-gray-700 p-6">
      <h3 className="text-sm font-semibold text-white mb-4">Reading the book</h3>
      <div className="flex items-center justify-between bg-[#141414] rounded-lg p-4 mb-3">
        <div className={`text-center transition-all duration-300 ${highlight === 0 ? 'scale-110' : 'opacity-40'}`}>
          <p className="text-sm font-medium text-space-success">62.00¢</p>
          <p className="text-xs text-space-gray-300 font-mono">850</p>
          <p className="text-[10px] text-space-success mt-1">Best Bid</p>
        </div>
        <div className={`px-4 py-2 rounded-lg transition-all duration-300 ${highlight === 1 ? 'bg-white/5 scale-110' : 'opacity-40'}`}>
          <p className="text-xs text-space-primary font-semibold">1.00¢</p>
          <p className="text-[10px] text-space-gray-400">Spread</p>
        </div>
        <div className={`text-center transition-all duration-300 ${highlight === 2 ? 'scale-110' : 'opacity-40'}`}>
          <p className="text-sm font-medium text-space-danger">63.00¢</p>
          <p className="text-xs text-space-gray-300 font-mono">780</p>
          <p className="text-[10px] text-space-danger mt-1">Best Ask</p>
        </div>
      </div>
      <p className="text-sm text-center text-white font-medium h-5">{labels[highlight]}</p>
    </div>
  );
}

function OrderMatchMock() {
  const [step, setStep] = useState(0);
  useEffect(() => { const t = setInterval(() => setStep(s => (s + 1) % 4), 2000); return () => clearInterval(t); }, []);
  const cursorX = step <= 1 ? 30 : step === 2 ? 50 : 70;
  return (
    <div className="bg-space-gray-800 rounded-xl border border-space-gray-700 p-6 relative">
      <h3 className="text-sm font-semibold text-white mb-4">How orders match</h3>
      <div className="flex items-center justify-center gap-4 py-3">
        <div className={`p-3 rounded-lg transition-all duration-500 ${step >= 1 ? 'bg-space-success/10 border border-space-success/30' : 'bg-[#141414]'}`}>
          <p className="text-[10px] text-space-gray-400">Buy order</p>
          <p className="text-sm text-space-success font-semibold">63.00¢</p>
        </div>
        <div className={`transition-all duration-500 ${step >= 2 ? 'opacity-100 scale-100' : 'opacity-0 scale-50'}`}>
          <svg className="w-6 h-6 text-yellow-400 animate-pulse" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M7.5 21L3 16.5m0 0L7.5 12M3 16.5h13.5m0-13.5L21 7.5m0 0L16.5 12M21 7.5H7.5" />
          </svg>
        </div>
        <div className={`p-3 rounded-lg transition-all duration-500 ${step >= 1 ? 'bg-space-danger/10 border border-space-danger/30' : 'bg-[#141414]'}`}>
          <p className="text-[10px] text-space-gray-400">Sell order</p>
          <p className="text-sm text-space-danger font-semibold">63.00¢</p>
        </div>
      </div>
      {step >= 3 && (
        <div className="p-3 bg-green-500/10 border border-green-500/30 rounded-xl text-center">
          <p className="text-sm text-green-400">Trade executed at 63.00¢</p>
        </div>
      )}
      <AnimatedCursor targetX={cursorX} targetY={55} clicking={step === 2} />
    </div>
  );
}

function DepthMock() {
  return (
    <div className="bg-space-gray-800 rounded-xl border border-space-gray-700 p-6">
      <h3 className="text-sm font-semibold text-white mb-4">Market depth</h3>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <p className="text-xs text-space-gray-400 mb-2">Deep order book (liquid)</p>
          <div className="space-y-0.5">
            {[90, 75, 60, 45, 30].map((w, i) => (
              <div key={i} className="h-5 rounded relative">
                <div className="absolute right-0 top-0 bottom-0 bg-space-success/15 rounded" style={{ width: `${w}%` }} />
              </div>
            ))}
          </div>
          <p className="text-[10px] text-space-success mt-1">Low price impact</p>
        </div>
        <div>
          <p className="text-xs text-space-gray-400 mb-2">Thin order book</p>
          <div className="space-y-0.5">
            {[20, 12, 8, 5, 3].map((w, i) => (
              <div key={i} className="h-5 rounded relative">
                <div className="absolute left-0 top-0 bottom-0 bg-space-danger/15 rounded" style={{ width: `${w}%` }} />
              </div>
            ))}
          </div>
          <p className="text-[10px] text-space-danger mt-1">High price impact</p>
        </div>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────
// HOW TO SELL
// ─────────────────────────────────────────────

function WhySellMock() {
  const price = useAnimatedValue(45, 78, 4000);
  return (
    <div className="bg-[#141414] rounded-xl overflow-hidden p-5 space-y-4">
      <div className="flex justify-between items-center text-sm p-3 bg-[#1a1a1a] rounded-lg">
        <span className="text-gray-400">Spot Position - Yes</span>
        <span className="text-white font-semibold">100.00 shares</span>
      </div>
      <div className="space-y-3">
        <div className="flex justify-between text-sm">
          <span className="text-gray-500">Entry Price</span>
          <span className="text-white font-semibold">45.00¢</span>
        </div>
        <div className="flex justify-between text-sm">
          <span className="text-gray-500">Current Price</span>
          <span className="text-white font-semibold">{Math.round(price)}.00¢</span>
        </div>
      </div>
      <div className="border-t border-[#262626] pt-4">
        <div className="flex items-center justify-between">
          <p className="text-sm text-[#5CDB2A] font-medium">Unrealized Profit</p>
          <p className="text-2xl font-bold text-[#5CDB2A]">+${((price - 45)).toFixed(0)}.00</p>
        </div>
      </div>
    </div>
  );
}

function SellMock() {
  const { pos, clicking, stepIndex } = useCursorSequence([
    { x: 20, y: 4, delay: 1000 },            // move to Sell tab
    { x: 20, y: 4, click: true, delay: 500 }, // click Sell
    { x: 50, y: 60, delay: 1500 },            // move to Sell button
    { x: 50, y: 60, click: true, delay: 500 }, // click Sell
    { x: 50, y: 75, delay: 3000 },            // rest
  ]);
  const sold = stepIndex >= 4;
  return (
    <div className="bg-[#141414] rounded-xl overflow-hidden relative">
      <div className="flex items-center justify-between border-b border-[#262626]">
        <div className="flex px-4">
          <button className="px-4 py-3 text-sm font-semibold text-[#909090]">Buy</button>
          <button className="px-4 py-3 text-sm font-semibold text-white border-b-2 border-white">Sell</button>
        </div>
        <div className="px-4 py-2 mr-2 font-semibold text-sm text-[#909090] flex items-center gap-1">
          Market <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" /></svg>
        </div>
      </div>
      <div className="p-5 space-y-5">
        <div className="flex justify-between items-center text-sm p-3 bg-[#1a1a1a] rounded-lg">
          <span className="text-gray-400">Spot Position - Yes</span>
          <span className="text-white font-semibold">100.00 shares</span>
        </div>
        <div>
          <label className="text-xs text-[#909090] capitalize tracking-wide">Shares</label>
          <div className="flex items-baseline gap-1 mt-1">
            <span className="text-4xl font-bold text-white">100</span>
          </div>
          <p className="text-xs text-[#606060] mt-1">$72.00 @ 72¢ per share</p>
        </div>
        <div className="flex gap-2">
          {['+1', '+20', '+100', 'MAX'].map(v => (
            <button key={v} className="px-3 py-1.5 border border-[#3B3B3B] text-white text-sm font-medium rounded-lg">{v}</button>
          ))}
        </div>
        <button className={`w-full py-4 font-semibold rounded-xl transition-all duration-500 ${
          sold ? 'bg-green-500/10 border border-green-500/30 text-green-400' : 'bg-[#ffffff] text-black'
        }`}>
          {sold ? 'Sold for $72.00' : 'Sell YES'}
        </button>
        <div className="space-y-3">
          <div className="flex justify-between text-sm">
            <span className="text-gray-500">You Will Receive</span>
            <span className="text-white font-semibold">$72.00</span>
          </div>
        </div>
      </div>
      <AnimatedCursor targetX={pos.x} targetY={pos.y} clicking={clicking} />
    </div>
  );
}

function LimitSellMock() {
  return (
    <div className="bg-[#141414] rounded-xl overflow-hidden">
      <div className="flex items-center justify-between border-b border-[#262626]">
        <div className="flex px-4">
          <button className="px-4 py-3 text-sm font-semibold text-[#909090]">Buy</button>
          <button className="px-4 py-3 text-sm font-semibold text-white border-b-2 border-white">Sell</button>
        </div>
        <div className="px-4 py-2 mr-2 font-semibold text-sm text-white flex items-center gap-1">
          Limit <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" /></svg>
        </div>
      </div>
      <div className="p-5 space-y-5">
        <div>
          <label className="text-xs text-[#909090] capitalize tracking-wide">Limit Price (Cents)</label>
          <div className="flex items-baseline gap-1 mt-1">
            <span className="text-2xl font-bold text-white">80</span>
            <span className="text-2xl font-bold text-[#909090]">¢</span>
          </div>
          <p className="text-xs text-[#606060] mt-1">Current: 72.00¢</p>
        </div>
        <div>
          <label className="text-xs text-[#909090] capitalize tracking-wide">Shares</label>
          <div className="flex items-baseline gap-1 mt-1">
            <span className="text-4xl font-bold text-white">100</span>
          </div>
          <p className="text-xs text-[#606060] mt-1">$80.00 @ 80¢ per share</p>
        </div>
        <button className="w-full py-4 font-semibold rounded-xl bg-[#ffffff] text-black">Sell YES</button>
      </div>
    </div>
  );
}

function RedeemMock() {
  const { pos, clicking, stepIndex } = useCursorSequence([
    { x: 50, y: 30, delay: 1500 },
    { x: 50, y: 85, delay: 800 },
    { x: 50, y: 85, click: true, delay: 500 },
    { x: 50, y: 30, delay: 3500 },
  ]);
  const redeemed = stepIndex >= 3;
  return (
    <div className="bg-[#141414] rounded-xl overflow-hidden p-5 space-y-4 relative">
      <div className="p-3 bg-green-500/10 border border-green-500/30 rounded-xl">
        <div className="flex items-center gap-2 mb-1">
          <svg className="w-4 h-4 text-green-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75L11.25 15 15 9.75M21 12a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
          <span className="text-sm text-green-400 font-semibold">Market Finalized - You Won!</span>
        </div>
        <p className="text-xs text-[#A3A3A3]">100 winning shares @ $1.00 each</p>
      </div>
      <div className="space-y-3">
        <div className="flex justify-between text-sm">
          <span className="text-gray-500">Shares</span>
          <span className="text-white font-semibold">100.00</span>
        </div>
        <div className="flex justify-between text-sm">
          <span className="text-gray-500">Payout per share</span>
          <span className="text-white font-semibold">$1.00</span>
        </div>
      </div>
      <button className={`w-full py-4 font-semibold rounded-xl transition-all duration-500 ${
        redeemed ? 'bg-green-500/10 border border-green-500/30 text-green-400' : 'bg-[#ffffff] text-black'
      }`}>
        {redeemed ? 'Redeemed $100.00' : 'Redeem $100.00'}
      </button>
      <AnimatedCursor targetX={pos.x} targetY={pos.y} clicking={clicking} />
    </div>
  );
}

// ─────────────────────────────────────────────
// WHY ORDER DIDN'T FILL
// ─────────────────────────────────────────────

function PriceNotReachedMock() {
  const price = useAnimatedValue(5500, 4200, 5000);
  const filled = price <= 4000;
  return (
    <div className="bg-[#141414] rounded-xl overflow-hidden p-5 space-y-4">
      <div className="space-y-3">
        <div className="flex justify-between text-sm">
          <span className="text-gray-500">Your Limit Price</span>
          <span className="text-white font-semibold">40.00¢</span>
        </div>
        <div className="flex justify-between text-sm">
          <span className="text-gray-500">Market Price</span>
          <span className={`font-semibold ${filled ? 'text-[#5CDB2A]' : 'text-white'}`}>{(price / 100).toFixed(2)}¢</span>
        </div>
        <div className="flex justify-between text-sm">
          <span className="text-gray-500">Gap</span>
          <span className={`font-semibold ${filled ? 'text-[#5CDB2A]' : 'text-yellow-400'}`}>{filled ? 'Matched!' : `${((price - 4000) / 100).toFixed(2)}¢ away`}</span>
        </div>
      </div>
      <div className={`p-3 rounded-xl transition-all duration-300 ${
        filled ? 'bg-green-500/10 border border-green-500/30' : 'bg-yellow-500/10 border border-yellow-500/30'
      }`}>
        <p className={`text-sm ${filled ? 'text-green-400' : 'text-yellow-400'}`}>
          {filled ? 'Price reached - order fills!' : 'Price hasn\'t reached your limit yet'}
        </p>
      </div>
    </div>
  );
}

function InsufficientLiquidityMock() {
  const fill = useAnimatedValue(0, 40, 4000);
  return (
    <div className="bg-[#141414] rounded-xl overflow-hidden p-5 space-y-4">
      <div className="space-y-3">
        <div className="flex justify-between text-sm">
          <span className="text-gray-500">Requested</span>
          <span className="text-white font-semibold">100 shares</span>
        </div>
        <div className="flex justify-between text-sm">
          <span className="text-gray-500">Filled</span>
          <span className="text-[#5CDB2A] font-semibold">{Math.round(fill)} shares</span>
        </div>
        <div className="flex justify-between text-sm">
          <span className="text-gray-500">Remaining</span>
          <span className="text-yellow-400 font-semibold">{100 - Math.round(fill)} shares</span>
        </div>
      </div>
      <div className="h-2 bg-[#262626] rounded-full overflow-hidden">
        <div className="h-full bg-[#5CDB2A] rounded-full transition-all duration-100" style={{ width: `${fill}%` }} />
      </div>
      <div className="p-3 bg-yellow-500/10 border border-yellow-500/30 rounded-xl">
        <p className="text-sm text-yellow-400">Partial fill - waiting for more liquidity</p>
      </div>
    </div>
  );
}

function MarketEndedMock() {
  return (
    <div className="bg-[#141414] rounded-xl overflow-hidden p-5">
      <div className="p-4 bg-gray-500/10 border border-gray-500/30 rounded-lg text-center mb-4">
        <p className="text-sm text-gray-400">Trading is disabled</p>
        <p className="text-xs text-gray-500 mt-1">Market status: Ended - Awaiting Resolution</p>
      </div>
      <div className="space-y-2">
        {[
          { status: 'Active', canTrade: true },
          { status: 'Ended', canTrade: false },
          { status: 'Pending Resolution', canTrade: false },
          { status: 'Resolved', canTrade: false },
        ].map(s => (
          <div key={s.status} className="flex items-center justify-between p-3 bg-[#1a1a1a] rounded-lg">
            <span className="text-sm text-white">{s.status}</span>
            <span className={`text-xs font-semibold ${s.canTrade ? 'text-[#5CDB2A]' : 'text-red-400'}`}>
              {s.canTrade ? 'Can trade' : 'No trading'}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

function TxFailedMock() {
  const { pos, clicking, stepIndex } = useCursorSequence([
    { x: 50, y: 50, delay: 2500 },
    { x: 50, y: 50, click: true, delay: 500 },
    { x: 50, y: 50, delay: 2500 },
  ]);
  const failed = stepIndex === 0;
  return (
    <div className="bg-[#141414] rounded-xl overflow-hidden p-5 relative">
      <div className={`p-3 rounded-xl transition-all duration-500 ${
        failed ? 'bg-red-500/10 border border-red-500/30' : 'bg-green-500/10 border border-green-500/30'
      }`}>
        <p className={`text-sm ${failed ? 'text-red-400' : 'text-green-400'}`}>
          {failed ? 'Transaction failed' : 'Transaction confirmed'}
        </p>
        <p className="text-xs text-[#606060] mt-1">
          {failed ? 'USDC was not spent. Check SOL balance for gas fees.' : 'Shares have been added to your portfolio.'}
        </p>
      </div>
      <AnimatedCursor targetX={pos.x} targetY={pos.y} clicking={clicking} />
    </div>
  );
}

// ─────────────────────────────────────────────
// MARKET VS LIMIT
// ─────────────────────────────────────────────

function MarketOrderMock() {
  const { pos, clicking, stepIndex } = useCursorSequence([
    { x: 50, y: 30, delay: 1500 },
    { x: 50, y: 82, delay: 800 },
    { x: 50, y: 82, click: true, delay: 500 },
    { x: 50, y: 30, delay: 3000 },
  ]);
  const exec = stepIndex >= 3;
  return (
    <div className="bg-[#141414] rounded-xl overflow-hidden relative">
      <div className="flex items-center justify-between border-b border-[#262626]">
        <div className="flex px-4">
          <button className="px-4 py-3 text-sm font-semibold text-white border-b-2 border-white">Buy</button>
          <button className="px-4 py-3 text-sm font-semibold text-[#909090]">Sell</button>
        </div>
        <div className="px-4 py-2 mr-2 font-semibold text-sm text-white flex items-center gap-1">Market</div>
      </div>
      <div className="p-5 space-y-4">
        <div className="space-y-3">
          <div className="flex justify-between text-sm">
            <span className="text-gray-500">Speed</span>
            <span className="text-[#5CDB2A] font-semibold">Instant</span>
          </div>
          <div className="flex justify-between text-sm">
            <span className="text-gray-500">Price guarantee</span>
            <span className="text-red-400 font-semibold">No (slippage possible)</span>
          </div>
        </div>
        {/* Slippage control */}
        <div>
          <label className="text-xs text-[#909090] capitalize tracking-wide">Max Slippage (%)</label>
          <div className="flex items-center gap-2 mt-1">
            <div className="w-16 px-3 py-2 bg-[#1a1a1a] border border-[#3B3B3B] rounded-lg text-white text-sm font-medium">5</div>
            <span className="text-sm text-[#909090]">%</span>
            <div className="flex gap-1 ml-2">
              {[1, 5, 10].map(v => (
                <span key={v} className={`px-2 py-1 text-xs rounded ${v === 5 ? 'bg-[#5CDB2A] text-white' : 'bg-[#262626] text-[#909090]'}`}>{v}%</span>
              ))}
            </div>
          </div>
        </div>
        <button className={`w-full py-4 font-semibold rounded-xl transition-all duration-500 ${
          exec ? 'bg-green-500/10 border border-green-500/30 text-green-400' : 'bg-[#ffffff] text-black'
        }`}>
          {exec ? 'Filled @ 64¢' : 'Buy Now'}
        </button>
      </div>
      <AnimatedCursor targetX={pos.x} targetY={pos.y} clicking={clicking} />
    </div>
  );
}

function LimitOrderMock() {
  const { pos, clicking, stepIndex } = useCursorSequence([
    { x: 50, y: 40, delay: 1200 },
    { x: 50, y: 82, delay: 800 },
    { x: 50, y: 82, click: true, delay: 500 },
    { x: 50, y: 60, delay: 2500 },
    { x: 50, y: 60, delay: 2500 },
  ]);
  const status = stepIndex <= 2 ? 'set' as const : stepIndex === 3 ? 'waiting' as const : 'filled' as const;
  return (
    <div className="bg-[#141414] rounded-xl overflow-hidden relative">
      <div className="flex items-center justify-between border-b border-[#262626]">
        <div className="flex px-4">
          <button className="px-4 py-3 text-sm font-semibold text-white border-b-2 border-white">Buy</button>
          <button className="px-4 py-3 text-sm font-semibold text-[#909090]">Sell</button>
        </div>
        <div className="px-4 py-2 mr-2 font-semibold text-sm text-white flex items-center gap-1">Limit</div>
      </div>
      <div className="p-5 space-y-4">
        <div className="space-y-3">
          <div className="flex justify-between text-sm">
            <span className="text-gray-500">Speed</span>
            <span className="text-yellow-400 font-semibold">When price matches</span>
          </div>
          <div className="flex justify-between text-sm">
            <span className="text-gray-500">Price guarantee</span>
            <span className="text-[#5CDB2A] font-semibold">Yes (exact or better)</span>
          </div>
        </div>
        <div>
          <label className="text-xs text-[#909090] capitalize tracking-wide">Limit Price (Cents)</label>
          <div className="flex items-baseline gap-1 mt-1">
            <span className="text-2xl font-bold text-white">45</span>
            <span className="text-2xl font-bold text-[#909090]">¢</span>
          </div>
        </div>
        <button className={`w-full py-4 font-semibold rounded-xl transition-all duration-500 ${
          status === 'filled' ? 'bg-green-500/10 border border-green-500/30 text-green-400'
            : status === 'waiting' ? 'bg-yellow-500/10 border border-yellow-500/30 text-yellow-400'
            : 'bg-[#ffffff] text-black'
        }`}>
          {status === 'filled' ? 'Filled @ 45¢' : status === 'waiting' ? 'Waiting for match...' : 'Place Limit Order'}
        </button>
      </div>
      <AnimatedCursor targetX={pos.x} targetY={pos.y} clicking={clicking} />
    </div>
  );
}

function SlippageMock() {
  return (
    <div className="bg-[#141414] rounded-xl overflow-hidden p-5 space-y-4">
      <h3 className="text-sm font-semibold text-white">Price impact by order size</h3>
      <div className="space-y-2">
        {[
          { size: '$10', impact: '0.01%', color: 'text-[#5CDB2A]' },
          { size: '$100', impact: '0.5%', color: 'text-[#5CDB2A]' },
          { size: '$500', impact: '1.8%', color: 'text-yellow-400' },
          { size: '$1,000', impact: '3.2%', color: 'text-red-400' },
        ].map((r, i) => (
          <div key={i} className="flex justify-between items-center p-3 bg-[#1a1a1a] rounded-lg">
            <span className="text-sm text-white">{r.size} order</span>
            <span className={`text-sm font-semibold ${r.color}`}>Slippage: {r.impact}</span>
          </div>
        ))}
      </div>
      <p className="text-xs text-[#606060]">Limit orders avoid slippage entirely since you set the maximum price.</p>
    </div>
  );
}

function WhichOrderMock() {
  return (
    <div className="bg-[#141414] rounded-xl overflow-hidden p-5">
      <div className="grid grid-cols-2 gap-3">
        <div className="bg-[#1a1a1a] rounded-lg p-4">
          <p className="text-sm text-white font-semibold mb-3">Use Market</p>
          <div className="space-y-2">
            {['Small trades', 'Liquid markets', 'Need speed'].map(t => (
              <div key={t} className="flex items-center gap-2">
                <div className="w-1.5 h-1.5 rounded-full bg-[#5CDB2A]" />
                <span className="text-xs text-[#A3A3A3]">{t}</span>
              </div>
            ))}
          </div>
        </div>
        <div className="bg-[#1a1a1a] rounded-lg p-4">
          <p className="text-sm text-white font-semibold mb-3">Use Limit</p>
          <div className="space-y-2">
            {['Large trades', 'Price targets', 'Thin order books'].map(t => (
              <div key={t} className="flex items-center gap-2">
                <div className="w-1.5 h-1.5 rounded-full bg-space-primary" />
                <span className="text-xs text-[#A3A3A3]">{t}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────
// WIN/LOSS
// ─────────────────────────────────────────────

function ResolutionProcessMock() {
  const [step, setStep] = useState(0);
  useEffect(() => { const t = setInterval(() => setStep(s => (s + 1) % 5), 1500); return () => clearInterval(t); }, []);
  const steps = ['Event occurs', 'Admin resolves', 'Waiting period', 'Finalized'];
  const stepX = [12, 37, 62, 87];
  return (
    <div className="bg-[#141414] rounded-xl overflow-hidden p-5 relative">
      <div className="flex items-center justify-between">
        {steps.map((s, i) => (
          <div key={s} className="flex flex-col items-center gap-2 flex-1">
            <div className={`w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold transition-all duration-300 ${
              i < step ? 'bg-[#5CDB2A] text-white' : i === step ? 'bg-white text-black' : 'bg-[#262626] text-[#909090]'
            }`}>{i + 1}</div>
            <span className={`text-[10px] text-center transition-all duration-300 ${i <= step ? 'text-white' : 'text-[#525252]'}`}>{s}</span>
            {i < steps.length - 1 && <div className={`w-full h-0.5 ${i < step ? 'bg-[#5CDB2A]' : 'bg-[#262626]'}`} />}
          </div>
        ))}
      </div>
      <AnimatedCursor targetX={stepX[Math.min(step, 3)]} targetY={35} clicking={false} />
    </div>
  );
}

function WinMock() {
  return (
    <div className="bg-[#141414] rounded-xl overflow-hidden p-5 space-y-4">
      <div className="p-3 bg-green-500/10 border border-green-500/30 rounded-xl">
        <p className="text-sm text-green-400 font-semibold">Market Finalized - You Won!</p>
      </div>
      <div className="space-y-3">
        <div className="flex justify-between text-sm">
          <span className="text-gray-500">You Paid</span>
          <span className="text-white font-semibold">$0.40 per share</span>
        </div>
        <div className="flex justify-between text-sm">
          <span className="text-gray-500">Payout</span>
          <span className="text-white font-semibold">$1.00 per share</span>
        </div>
        <div className="flex justify-between text-sm">
          <span className="text-gray-500">Shares held</span>
          <span className="text-white font-semibold">100</span>
        </div>
      </div>
      <div className="border-t border-[#262626] pt-4">
        <div className="flex items-center justify-between">
          <p className="text-sm text-[#5CDB2A] font-medium">Net Profit</p>
          <p className="text-2xl font-bold text-[#5CDB2A]">+$60.00</p>
        </div>
      </div>
    </div>
  );
}

function LossMock() {
  return (
    <div className="bg-[#141414] rounded-xl overflow-hidden p-5 space-y-4">
      <div className="p-3 bg-red-500/10 border border-red-500/30 rounded-xl">
        <p className="text-sm text-red-400 font-semibold">Market Finalized - You Lost</p>
      </div>
      <div className="space-y-3">
        <div className="flex justify-between text-sm">
          <span className="text-gray-500">You Paid</span>
          <span className="text-white font-semibold">$0.65 per share</span>
        </div>
        <div className="flex justify-between text-sm">
          <span className="text-gray-500">Payout</span>
          <span className="text-white font-semibold">$0.00</span>
        </div>
        <div className="flex justify-between text-sm">
          <span className="text-gray-500">Shares held</span>
          <span className="text-white font-semibold">100</span>
        </div>
      </div>
      <div className="border-t border-[#262626] pt-4">
        <div className="flex items-center justify-between">
          <p className="text-sm text-red-400 font-medium">Total Loss</p>
          <p className="text-2xl font-bold text-red-400">-$65.00</p>
        </div>
      </div>
    </div>
  );
}

function PnLMock() {
  return (
    <div className="bg-[#141414] rounded-xl overflow-hidden p-5 space-y-4">
      <h3 className="text-sm text-white font-semibold">P&L Calculation</h3>
      <div className="space-y-3">
        <div className="flex justify-between text-sm">
          <span className="text-gray-500">100 shares @ 65¢</span>
          <span className="text-white font-semibold">Cost: $65.00</span>
        </div>
        <div className="flex justify-between text-sm">
          <span className="text-gray-500">Payout (if win)</span>
          <span className="text-white font-semibold">$100.00</span>
        </div>
      </div>
      <div className="border-t border-[#262626] pt-4">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-sm text-[#5CDB2A] font-medium">Potential Profit (Yes)</p>
            <p className="text-sm text-[#A3A3A3]">Entry Price 65.00¢</p>
          </div>
          <p className="text-2xl font-bold text-[#5CDB2A]">$35.00</p>
        </div>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────
// ILLUSTRATION MAP
// ─────────────────────────────────────────────

const illustrationMap: Record<string, Record<number, () => ReactNode>> = {
  'how-to-buy': {
    0: () => <ConnectWalletMock />,
    1: () => <FindMarketMock />,
    2: () => <PlaceTradeMock />,
    3: () => <PricingMock />,
  },
  'how-to-buy-with-leverage': {
    0: () => <LeverageExplainMock />,
    1: () => <LeverageSliderMock />,
    2: () => <MarginMock />,
    3: () => <BestPracticesMock />,
  },
  'how-to-place-a-limit-order': {
    0: () => <LimitOrderTabsMock />,
    1: () => <LimitPriceMock />,
    2: () => <OrderFillMock />,
    3: () => <OpenOrdersMock />,
  },
  'order-book-explained': {
    0: () => <OrderBookVisualMock />,
    1: () => <OrderBookReadMock />,
    2: () => <OrderMatchMock />,
    3: () => <DepthMock />,
  },
  'how-to-sell': {
    0: () => <WhySellMock />,
    1: () => <SellMock />,
    2: () => <LimitSellMock />,
    3: () => <RedeemMock />,
  },
  'why-my-order-did-not-fill': {
    0: () => <PriceNotReachedMock />,
    1: () => <InsufficientLiquidityMock />,
    2: () => <MarketEndedMock />,
    3: () => <TxFailedMock />,
  },
  'market-order-vs-limit-order': {
    0: () => <MarketOrderMock />,
    1: () => <LimitOrderMock />,
    2: () => <SlippageMock />,
    3: () => <WhichOrderMock />,
  },
  'win-loss-after-market-resolution': {
    0: () => <ResolutionProcessMock />,
    1: () => <WinMock />,
    2: () => <LossMock />,
    3: () => <PnLMock />,
  },
};

export function GuideIllustration({ slug, stepIndex }: { slug: string; stepIndex: number }) {
  const renderer = illustrationMap[slug]?.[stepIndex];
  if (!renderer) return null;
  return <div className="mt-4 ml-10">{renderer()}</div>;
}
