import { AdminLayout } from "@/components/AdminLayout";
import { useWallet } from "@solana/wallet-adapter-react";
import { isAdminWallet } from "@/utils/admin";
import { useState, useEffect } from "react";

interface Step {
  number: number;
  title: string;
  description: string;
}

interface GuideSection {
  id: string;
  title: string;
  subtitle: string;
  color: string;
  borderColor: string;
  badgeBg: string;
  badgeText: string;
  dotColor: string;
  steps: Step[];
}

const sections: GuideSection[] = [
  {
    id: "market-creation",
    title: "Market Creation",
    subtitle:
      "Follow these steps to create a new prediction market on the platform.",
    color: "bg-blue-500",
    borderColor: "border-blue-500/20",
    badgeBg: "bg-blue-500",
    badgeText: "text-white",
    dotColor: "bg-blue-500",
    steps: [
      {
        number: 1,
        title: "Go to Create Market",
        description:
          'Navigate to the "Create Market" page from the sidebar under the Markets section.',
      },
      {
        number: 2,
        title: "Upload Image",
        description:
          "Click the image upload area to select a cover image for your market. This will be displayed as the market thumbnail.",
      },
      {
        number: 3,
        title: "Enter Market Title",
        description:
          'Provide a clear and concise title for your market. This should describe the prediction question (e.g., "Will BTC hit $100k by June 2026?").',
      },
      {
        number: 4,
        title: "Enter Description",
        description:
          "Add a detailed description explaining the market, its context, and any relevant information traders should know before participating.",
      },
      {
        number: 5,
        title: "Select Category",
        description:
          "Choose the appropriate category for your market (e.g., Crypto, Sports, Politics, etc.) to help users discover it.",
      },
      {
        number: 6,
        title: "Choose End Date",
        description:
          "Set the end date and time for the market. This is when trading will stop and the market will await resolution.",
      },
      {
        number: 7,
        title: "Select Resolution — Manual",
        description:
          'Choose "Manual" as the resolution method. This means the admin will manually resolve the market outcome after the end date.',
      },
      {
        number: 8,
        title: "Add Outcomes",
        description:
          "Define the possible outcomes for the market. Images for outcomes are optional but recommended for better visual presentation. NOTE: Add outcomes only for multi-outcome markets. Don’t make any changes to binary markets.",
      },
      {
        number: 9,
        title: "Set Initial Collateral",
        description:
          "Enter the initial collateral amount (in USDC) that will be deposited to seed the market liquidity.",
      },
      {
        number: 10,
        title: "Create Market & Sign Transactions",
        description:
          'Click the "Create Market" button. Your wallet will prompt you to sign the on-chain transactions. Approve them to finalize the market creation.',
      },
    ],
  },
  {
    id: "fund-liquidity",
    title: "Fund Liquidity Vault",
    subtitle:
      "Fund a market's liquidity vault to enable leverage trading. Admin can fund any market at any time.",
    color: "bg-emerald-500",
    borderColor: "border-emerald-500/20",
    badgeBg: "bg-emerald-500",
    badgeText: "text-white",
    dotColor: "bg-emerald-500",
    steps: [
      {
        number: 1,
        title: "Go to Fund Liquidity Vault",
        description:
          'Navigate to "Fund Liquidity Vault" from the sidebar under the Liquidity section.',
      },
      {
        number: 2,
        title: "Select Market",
        description:
          "Choose the market you want to fund from the list. Admin can fund any market at any time if needed.",
      },
      {
        number: 3,
        title: "Fund & Confirm",
        description:
          "Enter the funding amount and confirm the transaction. This enables leverage trading for the selected market.",
      },
    ],
  },
  {
    id: "mint-shares",
    title: "Mint Shares",
    subtitle:
      "Mint Yes and No shares for a market to seed the order book with initial liquidity, enabling traders to start placing orders.",
    color: "bg-violet-500",
    borderColor: "border-violet-500/20",
    badgeBg: "bg-violet-500",
    badgeText: "text-white",
    dotColor: "bg-violet-500",
    steps: [
      {
        number: 1,
        title: "Open the Market Page",
        description:
          'Navigate to the market you want to seed (e.g., "Will Bitcoin hit $200k before 2027?") and open the trading panel.',
      },
      {
        number: 2,
        title: "Mint Yes & No Shares",
        description:
          "Enter the amount and mint both Yes and No shares for the market. These shares will be used to place initial orders on the order book.",
      },
      {
        number: 3,
        title: "Multi-Outcome Markets",
        description:
          "For multi-outcome markets, repeat the minting process for each outcome — mint Yes and No shares for every possible result to ensure full order book coverage.",
      },
    ],
  },
  {
    id: "seed-orderbook",
    title: "Seed Order Book",
    subtitle:
      "Automatically populate the order book with buy and sell orders across multiple price levels using the auto-signer. This bootstraps market liquidity so traders can begin trading immediately.",
    color: "bg-amber-500",
    borderColor: "border-amber-500/20",
    badgeBg: "bg-amber-500",
    badgeText: "text-white",
    dotColor: "bg-amber-500",
    steps: [
      {
        number: 1,
        title: "Go to Seed Order Book",
        description:
          'Navigate to "Seed Order Book" from the sidebar under the Liquidity section.',
      },
      {
        number: 2,
        title: "Select Market",
        description:
          "Choose the market you want to seed from the dropdown. Ensure you have already minted sufficient Yes and No shares for this market.",
      },
      {
        number: 3,
        title: "Import Keypair (Auto-Signer)",
        description:
          "Import your keypair to enable the auto-signer. This allows the system to sign multiple order transactions automatically without manual approval for each one. Your private key is used only in-memory for the current session and is never stored, transmitted, or persisted anywhere.",
      },
      {
        number: 4,
        title: "Configure Order Parameters",
        description:
          "Set the price range, spread, and number of orders to place on each side of the book. This determines how the liquidity will be distributed across price levels.",
      },
      {
        number: 5,
        title: "Execute Seeding",
        description:
          'Click "Seed Order Book" to begin. The auto-signer will batch-sign and submit all orders automatically. Monitor the progress as orders are placed on both the buy and sell sides.',
      },
      {
        number: 6,
        title: "Verify the Order Book",
        description:
          "Once seeding is complete, navigate to the market page and verify that the order book is populated with orders at the expected price levels.",
      },
    ],
  },
  {
    id: "market-resolution",
    title: "Market Resolution",
    subtitle:
      "Resolve a market after its end date has passed by selecting the winning outcome. Once resolved, traders can redeem their winning shares for payouts.",
    color: "bg-rose-500",
    borderColor: "border-rose-500/20",
    badgeBg: "bg-rose-500",
    badgeText: "text-white",
    dotColor: "bg-rose-500",
    steps: [
      {
        number: 1,
        title: "Go to Resolve Market",
        description:
          'Navigate to "Resolve Market" from the sidebar under the Markets section.',
      },
      {
        number: 2,
        title: "Select the Market",
        description:
          "Choose the market you want to resolve from the list. Only markets that have passed their end date are eligible for resolution.",
      },
      {
        number: 3,
        title: "Select the Winning Outcome",
        description:
          "Review the market question and select the correct winning outcome. For binary markets, choose Yes or No. For multi-outcome markets, select the outcome that matches the real-world result. NOTE: After a market is resolved to Yes or No, there is a 5-10 minute challenge period. The final resolution can only be confirmed once this period has passed.",
      },
      {
        number: 4,
        title: "Confirm & Sign Resolution",
        description:
          "Confirm your selection and sign the on-chain transaction. This action is irreversible — once resolved, the outcome cannot be changed. NOTE: Make sure add your wallet as oracle before resolving the market. Otherwise, you won’t be able to sign the resolution transaction and finalize the market outcome.",
      },
      {
        number: 5,
        title: "Traders Redeem Shares",
        description:
          "After resolution, traders holding winning shares can redeem them for their payouts. Losing shares become worthless. The redemption process is available on the market page.",
      },
    ],
  },
];

function SideNav({
  activeId,
  onNavigate,
}: {
  activeId: string;
  onNavigate: (id: string) => void;
}) {
  return (
    <div className="space-y-1">
      <p className="text-xs font-semibold text-[#525252] uppercase tracking-wider mb-3 px-3">
        On this page
      </p>
      {sections.map((section) => (
        <button
          key={section.id}
          onClick={() => onNavigate(section.id)}
          className={`w-full flex items-center gap-2.5 px-3 py-2 rounded-lg text-left text-sm transition-colors ${
            activeId === section.id
              ? "bg-[#1a1a1a] text-white"
              : "text-[#737373] hover:text-white hover:bg-[#111111]"
          }`}
        >
          <div
            className={`w-2 h-2 rounded-full flex-shrink-0 ${section.dotColor}`}
          />
          <span className="truncate">{section.title}</span>
        </button>
      ))}
    </div>
  );
}

export default function Guide() {
  const { connected, publicKey } = useWallet();
  const isAdmin = isAdminWallet(connected, publicKey);
  const [activeId, setActiveId] = useState(sections[0].id);

  useEffect(() => {
    const observers: IntersectionObserver[] = [];

    sections.forEach((section) => {
      const el = document.getElementById(section.id);
      if (!el) return;

      const observer = new IntersectionObserver(
        ([entry]) => {
          if (entry.isIntersecting) {
            setActiveId(section.id);
          }
        },
        { rootMargin: "-20% 0px -60% 0px" },
      );
      observer.observe(el);
      observers.push(observer);
    });

    return () => observers.forEach((o) => o.disconnect());
  }, []);

  const handleNavigate = (id: string) => {
    const el = document.getElementById(id);
    if (el) {
      el.scrollIntoView({ behavior: "smooth", block: "start" });
    }
  };

  if (!isAdmin) {
    return <AdminLayout title="Guide" description="Market creation guide" />;
  }

  return (
    <AdminLayout
      title="Guide"
      description="Step-by-step guide for setting up markets"
    >
      <div className="flex gap-8">
        {/* Main Content */}
        <div className="flex-1 min-w-0 space-y-10">
          {sections.map((section) => (
            <div
              key={section.id}
              id={section.id}
              className="space-y-3 scroll-mt-6"
            >
              {/* Section Header */}
              <div
                className={`bg-[#0a0a0a] rounded-2xl p-6 border ${section.borderColor}`}
              >
                <div className="flex items-center gap-3 mb-2">
                  <div className={`w-3 h-3 rounded-full ${section.color}`} />
                  <h2 className="text-xl font-bold text-white">
                    {section.title}
                  </h2>
                </div>
                <p className="text-sm text-[#a3a3a3] ml-6">
                  {section.subtitle}
                </p>
              </div>

              {/* Steps */}
              {section.steps.map((step) => (
                <div
                  key={step.number}
                  className={`bg-[#0a0a0a] rounded-2xl p-5 border ${section.borderColor} flex gap-4`}
                >
                  <div
                    className={`flex-shrink-0 w-8 h-8 rounded-full ${section.badgeBg} ${section.badgeText} flex items-center justify-center text-sm font-bold`}
                  >
                    {step.number}
                  </div>
                  <div className="flex-1 min-w-0">
                    <h3 className="text-white font-semibold text-sm">
                      {step.title}
                    </h3>
                    <p className="text-[#a3a3a3] text-sm mt-1 leading-relaxed">
                      {step.description}
                    </p>
                  </div>
                </div>
              ))}
            </div>
          ))}
        </div>

        {/* Right Side Navigation */}
        <div className="hidden lg:block w-48 flex-shrink-0">
          <div className="fixed top-[88px] w-48">
            <SideNav activeId={activeId} onNavigate={handleNavigate} />
          </div>
        </div>
      </div>
    </AdminLayout>
  );
}
