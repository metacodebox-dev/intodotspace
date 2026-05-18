import { ReactNode } from 'react';
import { useRouter } from 'next/router';
import Head from 'next/head';
import Link from 'next/link';
import { Layout } from '@/components/Layout';
import { GuideIllustration } from '@/components/guides/GuideIllustrations';
import { GetStaticPaths, GetStaticProps } from 'next';

interface GuideSection {
  heading?: string;
  body: string;
}

interface Guide {
  slug: string;
  title: string;
  description: string;
  icon: ReactNode;
  sections: GuideSection[];
}

const guides: Omit<Guide, 'icon'>[] = [
  {
    slug: 'how-to-buy',
    title: 'How to buy',
    description: 'Learn how to buy shares on Space prediction markets.',
    sections: [
      {
        heading: 'Connect your wallet',
        body: 'Click the "Connect Wallet" button in the top-right corner. Space supports Phantom, Solflare, and other Solana wallets. Make sure you have some SOL for transaction fees and USDC to trade.',
      },
      {
        heading: 'Find a market',
        body: 'Browse the Markets page to find an event you want to trade on. Use the category filters (Crypto, Politics, Sports, etc.) or the search bar to narrow things down.',
      },
      {
        heading: 'Place your trade',
        body: 'Click on the market card to open it. You\'ll see the current prices for each outcome. Select the outcome you believe in, enter the amount of USDC you want to spend, and click "Buy". The number of shares you receive depends on the current price.',
      },
      {
        heading: 'How pricing works',
        body: 'Prices reflect the market\'s implied probability. A share priced at $0.60 means the market thinks there\'s roughly a 60% chance that outcome happens. If you\'re right, each share pays out $1. If you\'re wrong, it pays $0.',
      },
    ],
  },
  {
    slug: 'how-to-buy-with-leverage',
    title: 'How to buy with leverage',
    description: 'Amplify your position using leverage on Space.',
    sections: [
      {
        heading: 'What is leverage?',
        body: 'Leverage lets you open a larger position than your deposited amount. For example, 2x leverage means $100 USDC controls $200 worth of shares. This amplifies both gains and losses.',
      },
      {
        heading: 'Selecting leverage',
        body: 'When placing a trade, toggle the leverage slider to your desired multiplier. Space offers up to 5x leverage on eligible markets. The interface will show your effective position size and liquidation price.',
      },
      {
        heading: 'Margin and liquidation',
        body: 'Your deposited USDC acts as margin. If the market moves against you far enough, your position may be liquidated to prevent losses beyond your margin. Monitor your positions in the Portfolio page.',
      },
      {
        heading: 'Best practices',
        body: 'Start with low leverage (2x) until you\'re comfortable. Keep an eye on your liquidation price. Higher leverage means higher risk \u2014 only use it when you have strong conviction.',
      },
    ],
  },
  {
    slug: 'how-to-place-a-limit-order',
    title: 'How to place a limit order',
    description: 'Set your price and wait for the market to come to you.',
    sections: [
      {
        heading: 'What is a limit order?',
        body: 'A limit order lets you specify the exact price at which you want to buy or sell shares. Your order sits on the order book until another trader matches it, or you cancel it.',
      },
      {
        heading: 'Placing a limit order',
        body: 'Open a market and switch to the "Limit" tab in the trading panel. Enter your desired price (e.g., $0.45 per share) and the amount of USDC you want to spend. Click "Place Order" to submit it to the order book.',
      },
      {
        heading: 'When does it fill?',
        body: 'Your order fills when the market price reaches your limit price. If you placed a buy at $0.45, it fills when someone is willing to sell at $0.45 or lower. Partial fills are possible \u2014 you may get some shares before the full order completes.',
      },
      {
        heading: 'Managing open orders',
        body: 'View your open orders in the Portfolio page under "Open Orders". You can cancel an unfilled order at any time to reclaim your USDC.',
      },
    ],
  },
  {
    slug: 'order-book-explained',
    title: 'Order book explained',
    description: 'Understand how the Space order book works.',
    sections: [
      {
        heading: 'What is the order book?',
        body: 'The order book is a list of all open buy and sell orders for a market. Buy orders (bids) are on the left, sell orders (asks) are on the right. The spread between the best bid and best ask is where trading happens.',
      },
      {
        heading: 'Reading the order book',
        body: 'Each row shows a price level and the total amount of shares available at that price. Green rows are buy orders, red rows are sell orders. The top of each side shows the best available price.',
      },
      {
        heading: 'How orders match',
        body: 'When a new buy order comes in at a price equal to or higher than the best sell price, a trade happens immediately. If no match exists, the order sits on the book waiting. The order book uses price-time priority \u2014 the best price gets filled first, and among equal prices, the earliest order goes first.',
      },
      {
        heading: 'Depth and liquidity',
        body: 'A "deep" order book with many orders at various prices means the market is liquid \u2014 you can trade larger amounts without moving the price much. Thin order books mean bigger price impact per trade.',
      },
    ],
  },
  {
    slug: 'how-to-sell',
    title: 'How to sell',
    description: 'Cash out your positions before the market resolves.',
    sections: [
      {
        heading: 'Why sell early?',
        body: 'You don\'t have to wait for the market to resolve. If the price of your shares has gone up, you can sell them to lock in a profit. Or if your thesis has changed, sell to limit your losses.',
      },
      {
        heading: 'Selling shares',
        body: 'Go to the market where you hold shares. Click the "Sell" tab in the trading panel. Enter how many shares you want to sell and confirm. A market sell executes instantly at the current best bid price.',
      },
      {
        heading: 'Limit sell',
        body: 'Switch to the "Limit" tab and enter the price you want to sell at. Your shares will be listed on the order book and sold when a buyer matches your price.',
      },
      {
        heading: 'After the market resolves',
        body: 'Once a market is finalized, winning shares are automatically redeemable for $1 each. Go to your Portfolio and click "Redeem" to claim your USDC.',
      },
    ],
  },
  {
    slug: 'why-my-order-did-not-fill',
    title: 'Why my order did not fill',
    description: 'Common reasons your order might not have executed.',
    sections: [
      {
        heading: 'Price not reached',
        body: 'For limit orders, the market price must reach your specified price. If you placed a buy at $0.40 but the market is trading at $0.55, your order won\'t fill until the price drops to $0.40.',
      },
      {
        heading: 'Insufficient liquidity',
        body: 'Even at the right price, there may not be enough shares available to fill your entire order. In this case, you\'ll get a partial fill. The remaining amount stays as an open order.',
      },
      {
        heading: 'Market ended',
        body: 'If a market has ended or is in the resolution phase, new trades cannot be placed. Check the market status \u2014 if it says "Ended", "Resolving", or "Finalized", trading is closed.',
      },
      {
        heading: 'Transaction failed',
        body: 'Occasionally Solana transactions can fail due to network congestion or insufficient SOL for fees. Check your wallet for the transaction status. If it failed, your USDC was not spent.',
      },
    ],
  },
  {
    slug: 'market-order-vs-limit-order',
    title: 'Market order vs Limit order',
    description: 'Understand the difference and when to use each.',
    sections: [
      {
        heading: 'Market orders',
        body: 'A market order executes immediately at the best available price on the order book. You\'re guaranteed a fill (if liquidity exists) but not a specific price. Best for when you want to trade now and the current price is acceptable.',
      },
      {
        heading: 'Limit orders',
        body: 'A limit order lets you set the exact price. It only executes at your price or better. You\'re guaranteed a price but not a fill. Best for when you\'re willing to wait for a better entry point.',
      },
      {
        heading: 'Price impact',
        body: 'Large market orders can "eat through" the order book, filling at progressively worse prices. This is called slippage. Limit orders avoid slippage entirely since you set the maximum price.',
      },
      {
        heading: 'Which should I use?',
        body: 'Use market orders for small trades in liquid markets where speed matters. Use limit orders for larger trades, less liquid markets, or when you have a specific price target. Most experienced traders primarily use limit orders.',
      },
    ],
  },
  {
    slug: 'win-loss-after-market-resolution',
    title: 'Win/loss after market resolution',
    description: 'What happens to your shares when a market resolves.',
    sections: [
      {
        heading: 'Resolution process',
        body: 'When a market\'s event occurs, an admin resolves the market by selecting the winning outcome. After a waiting period, the market is finalized and payouts begin.',
      },
      {
        heading: 'If you win',
        body: 'Each winning share pays out exactly $1 USDC. If you bought shares at $0.40, your profit is $0.60 per share (150% return). Go to your Portfolio and click "Redeem" to collect.',
      },
      {
        heading: 'If you lose',
        body: 'Losing shares pay out $0. The USDC you spent buying them is your total loss. There are no additional charges or negative balances.',
      },
      {
        heading: 'Calculating your P&L',
        body: 'Your profit/loss = (payout per share \u00d7 number of shares) \u2013 total cost. For example, if you bought 100 "Yes" shares at $0.65 each ($65 total) and "Yes" wins, you get $100 back for a $35 profit. The Portfolio page tracks your realized and unrealized P&L automatically.',
      },
    ],
  },
];

export const getStaticPaths: GetStaticPaths = async () => {
  return {
    paths: guides.map((g) => ({ params: { slug: g.slug } })),
    fallback: false,
  };
};

export const getStaticProps: GetStaticProps = async ({ params }) => {
  const slug = params?.slug as string;
  const guide = guides.find((g) => g.slug === slug);
  if (!guide) return { notFound: true };
  return { props: { guide } };
};

export default function HowToTradePage({ guide }: { guide: Omit<Guide, 'icon'> }) {
  const router = useRouter();

  const allGuides = guides.map((g) => ({ slug: g.slug, title: g.title }));
  const currentIndex = allGuides.findIndex((g) => g.slug === guide.slug);
  const prev = currentIndex > 0 ? allGuides[currentIndex - 1] : null;
  const next = currentIndex < allGuides.length - 1 ? allGuides[currentIndex + 1] : null;

  return (
    <>
      <Head>
        <title>{guide.title} - Space</title>
        <meta name="description" content={guide.description} />
      </Head>

      <Layout>
        <div className="max-w-3xl mx-auto py-10 px-4">
          {/* Breadcrumb */}
          <div className="flex items-center gap-2 text-sm text-[#737373] mb-8">
            <Link href="/" className="hover:text-white transition-colors">Home</Link>
            <span>/</span>
            <span className="text-[#a3a3a3]">How to trade</span>
            <span>/</span>
            <span className="text-white">{guide.title}</span>
          </div>

          {/* Title */}
          <h1 className="text-3xl font-bold text-white mb-3">{guide.title}</h1>
          <p className="text-[#a3a3a3] text-base mb-10">{guide.description}</p>

          {/* Sections */}
          <div className="space-y-8">
            {guide.sections.map((section, idx) => (
              <div key={idx} className="bg-[#141414] rounded-2xl border border-[#262626] p-6">
                {section.heading && (
                  <div className="flex items-center gap-3 mb-3">
                    <span className="flex items-center justify-center w-7 h-7 rounded-full bg-white/5 border border-[#333] text-xs font-bold text-white">
                      {idx + 1}
                    </span>
                    <h2 className="text-lg font-semibold text-white">{section.heading}</h2>
                  </div>
                )}
                <p className="text-[#a3a3a3] text-sm leading-relaxed pl-10">{section.body}</p>
                <GuideIllustration slug={guide.slug} stepIndex={idx} />
              </div>
            ))}
          </div>

          {/* Prev / Next navigation */}
          <div className="flex items-center justify-between mt-12 pt-8 border-t border-[#1a1a1a]">
            {prev ? (
              <Link
                href={`/how-to-trade/${prev.slug}`}
                className="flex items-center gap-2 text-sm text-[#a3a3a3] hover:text-white transition-colors"
              >
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 19.5L8.25 12l7.5-7.5" />
                </svg>
                {prev.title}
              </Link>
            ) : (
              <div />
            )}
            {next ? (
              <Link
                href={`/how-to-trade/${next.slug}`}
                className="flex items-center gap-2 text-sm text-[#a3a3a3] hover:text-white transition-colors"
              >
                {next.title}
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M8.25 4.5l7.5 7.5-7.5 7.5" />
                </svg>
              </Link>
            ) : (
              <div />
            )}
          </div>

          {/* All guides sidebar */}
          <div className="mt-12 bg-[#0a0a0a] rounded-2xl border border-[#1a1a1a] p-6">
            <h3 className="text-sm font-semibold text-[#737373] uppercase tracking-wider mb-4">All guides</h3>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              {allGuides.map((g) => (
                <Link
                  key={g.slug}
                  href={`/how-to-trade/${g.slug}`}
                  className={`px-4 py-2.5 rounded-xl text-sm transition-colors ${
                    g.slug === guide.slug
                      ? 'bg-white/5 text-white font-medium border border-[#333]'
                      : 'text-[#a3a3a3] hover:text-white hover:bg-[#141414]'
                  }`}
                >
                  {g.title}
                </Link>
              ))}
            </div>
          </div>
        </div>
      </Layout>
    </>
  );
}
