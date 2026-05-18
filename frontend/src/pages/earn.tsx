import Head from 'next/head';
import Image from 'next/image';
import { Layout } from '@/components/Layout';

export default function Earn() {
  return (
    <>
      <Head>
        <title>Earn - Space</title>
        <meta name="description" content="Earn rewards on Space" />
      </Head>

      <Layout>
        <div className="min-h-[60vh] flex items-center justify-center">
          <div className="w-full max-w-xl rounded-2xl border border-[#262626] bg-[#141414] p-10 text-center">
            
            <h1 className="text-3xl font-bold text-white">Coming Soon</h1>
            <p className="mt-3 text-sm text-space-gray-400">
              Earn rewards and bonuses for your activity on Space.
              Check back soon.
            </p>
          </div>
        </div>
      </Layout>
    </>
  );
}
