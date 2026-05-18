import Head from 'next/head';
import { Layout } from '@/components/Layout';
import { Positions } from '@/components/Positions';
import { useConnection, useWallet } from '@solana/wallet-adapter-react';
import Image from 'next/image';
import { MarketPriceChart } from '@/components/market';
import { Market } from '@/types/market';
import { getAccount, getAssociatedTokenAddress } from '@solana/spl-token';
import { USDC_MINT } from '@/utils/solana';
import { useEffect, useState } from 'react';
import { formatNumber } from '@/types/formateNumbers';
import { usePortfolioValue } from '@/hooks/usePortfolioValue';
import { useTotalPNL } from '@/hooks/useTotalPNL';

const mockMarket = {
  id: 1,
  title: 'Next US Presidential Election Winner?',
  description: 'Will the next US presidential election be won by the Democratic party?',
  imageUrl: '/assets/market-1.png',
};
const mockCurrentPrice = 69;

export default function Portfolio() {
  const { connected, publicKey } = useWallet();

  const [userUsdcBalance, setUserUsdcBalance] = useState<number | null>(null);
  const [checkingBalance, setCheckingBalance] = useState(false);
  const { connection } = useConnection();
  
  // Get dynamic portfolio value
  const { portfolioValue, loading: portfolioLoading } = usePortfolioValue();
  
  // Get total PNL from all positions
  const { totalPNL, loading: pnlLoading } = useTotalPNL();

  useEffect(() => {
    if (!connected || !publicKey) {
      setUserUsdcBalance(null);
      return;
    }

    const checkBalance = async () => {
      setCheckingBalance(true);
      try {
        const userUsdcATA = await getAssociatedTokenAddress(USDC_MINT, publicKey);
        const userUsdcAccount = await getAccount(connection, userUsdcATA);
        setUserUsdcBalance(Number(userUsdcAccount.amount));
      } catch (e) {
        setUserUsdcBalance(0);
      } finally {
        setCheckingBalance(false);
      }
    };

    checkBalance();
    const interval = setInterval(checkBalance, 30000);
    return () => clearInterval(interval);
  }, [connected, publicKey, connection]);

  if (!connected) {
    return (
      <Layout>
        <div className="text-center py-32">
          <h1 className="text-3xl font-bold text-white mb-4">Connect Your Wallet</h1>
          <p className="text-space-gray-400 mb-8">Please connect your wallet to view your portfolio</p>
        </div>
      </Layout>
    );
  }

  return (
    <>
      <Head>
        <title>Portfolio - Space</title>
        <meta name="description" content="View your trading portfolio and positions" />
      </Head>

      <Layout>
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-3 mb-6">
          {/* Left Column */}
          <div className='col-span-1 flex flex-col gap-2  rounded-xl border border-[#262626] p-3'>
            <div className='relative hover:scale-[1.02] transition-all duration-300 cursor-pointer'>
              <Image src="/assets/portfolio.svg" alt="Portfolio Background" width={1000} height={1000} className='w-full h-full object-cover rounded-xl' />
              <div className='absolute p-5 top-0 left-0 w-full h-full z-10'>

                <div className='relative z-10 flex flex-col gap-6 items-start '>
                  <Image src="/assets/portfolio-text.svg" alt="Portfolio Icon" width={1000} height={1000} className='w-28 object-cover' />

                  <p className='text-3xl font-bold text-[#5CDB2A]'>
                    {portfolioLoading ? '...' : `$${formatNumber((portfolioValue || 0).toFixed(2))}`}
                  </p>
                </div>
              </div>
            </div>


            <div className='relative hover:scale-[1.02] transition-all duration-300 cursor-pointer'>
              <Image src="/assets/balance-portfolio.svg" alt="Portfolio Background" width={1000} height={1000} className='w-full h-full object-cover rounded-xl' />
              <div className='absolute p-5 top-0 left-0 w-full h-full z-10'>

                <div className='relative z-10 flex flex-col gap-6 items-start '>
                  <Image src="/assets/balance-text.svg" alt="Portfolio Icon" width={1000} height={1000} className='w-28 object-cover' />

                  <p className='text-3xl font-bold text-[#B9E9F9]'>{checkingBalance ? '...' : userUsdcBalance !== null ? `$${formatNumber((userUsdcBalance / 1e6).toFixed(2))}` : '$0.00'}</p>
                </div>
              </div>
            </div>
            
          </div>


          <div className='col-span-2 flex flex-col gap-2  rounded-xl border border-[#262626] px-3 py-1'>

            <MarketPriceChart
              market={mockMarket as unknown as Market}
              currentPrice={mockCurrentPrice}
              isPortfolioChart={true}
              totalPNL={totalPNL}
              pnlLoading={pnlLoading}
            />
          </div>


        </div>

        {/* Positions */}
        <Positions />
      </Layout>
    </>
  );
}

