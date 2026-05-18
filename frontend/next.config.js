const withPWA = require("@ducanh2912/next-pwa").default({
  dest: "public",
  disable: process.env.NODE_ENV === "development",
  register: true,
  skipWaiting: true,
});

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  transpilePackages: ['@space/shared'],
  typescript: {
    ignoreBuildErrors: true,
  },
  images: {
    domains: [
      'pbs.twimg.com',
      // Supabase Storage domains - add your project ID here
      // Format: <project-id>.supabase.co
    ],
    remotePatterns: [
      {
        protocol: 'https',
        hostname: '*.supabase.co',
        pathname: '/storage/v1/object/public/**',
      },
      {
        protocol: 'https',
        hostname: 'polymarket-upload.s3.us-east-2.amazonaws.com',
      },
      {
        protocol: 'https',
        hostname: 'raw.githubusercontent.com',
        pathname: '/spothq/cryptocurrency-icons/**',
      },
      {
        protocol: 'https',
        hostname: 'assets.coingecko.com',
        pathname: '/coins/images/**',
      },
    ],
  },
  // Next.js 16 uses Turbopack by default for faster builds
  // Cache components for Partial Pre-Rendering (PPR)
  cacheComponents: true,
  // Empty Turbopack config to silence the warning (webpack config still needed for Solana)
  turbopack: {},
  // Webpack config for Solana compatibility (Node.js module fallbacks)
  webpack: (config) => {
    config.resolve.fallback = {
      ...config.resolve.fallback,
      fs: false,
      net: false,
      tls: false,
      crypto: false,
    };
    return config;
  },
};

module.exports = withPWA(nextConfig);
