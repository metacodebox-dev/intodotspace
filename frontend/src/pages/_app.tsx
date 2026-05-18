import '@/styles/globals.css';
import '@solana/wallet-adapter-react-ui/styles.css';
import type { AppProps } from 'next/app';
import Head from 'next/head';
import { WalletProvider } from '@/components/WalletProvider';
import { PositionsProvider } from '@/context/PositionsContext';
import { BookmarksProvider } from '@/context/BookmarksContext';

export default function App({ Component, pageProps }: AppProps) {
  return (
    <WalletProvider>
      <PositionsProvider>
        <BookmarksProvider>
          <Head>
            <meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no" />
          </Head>
          <Component {...pageProps} />
        </BookmarksProvider>
      </PositionsProvider>
    </WalletProvider>
  );
}


