# Space Prediction Markets Platform
   spl-token mint CqdmbJnQxMNNTGZzsBhEPTSzH52Pwa5DRvpVjZ2Us92t 1000000
A production-ready implementation of the Space prediction markets platform, built on Solana blockchain. This platform enables decentralized trading on real-world outcomes with features like Central Limit Order Book (CLOB), multi-outcome markets, leverage, dynamic fees, and liquidity rewards
 
## Architecture 
  
This is a monorepo containing
  
- **Programs/** - Solana smart contracts (Anchor framework) 
- **Backend/** - Node.js/Express API server 
- **Frontend/** - Next.js/React web application
- **Shared/** - Shared TypeScript types and utilities

## Core Features 
  
### Prediction Markets 
- YES/NO share trading with prices reflecting probability
- Share minting and burning for capital efficiency
- Continuous markets with real-time trading
 
### Central Limit Order Book (CLOB)
- Transparent on-chain order book
- Maker/Taker model
- Limit and market orders
- Real-time order matching

### Multi-Outcome Markets
- Support for multiple outcomes in a single market
- Shared liquidity across outcomes
- Seamless position adjustments

### Trading Features
- Up to 10x leverage
- Dynamic fee curve (0.02% - 2%)
- Zero fees for makers
- Instant execution for market orders

### Rewards & Incentives
- Liquidity rewards
- Points and airdrop system
- Referral rewards
- $SPACE token utility
- Flywheel mechanism (fee-to-value system)

### Market Resolution
- Deterministic resolution using blockchain data
- Oracle integration for real-world events
- Automated payouts

## Getting Started

### Prerequisites
- Node.js 18+
- Rust 1.70+
- Solana CLI
- Anchor framework
- PostgreSQL (for backend)

### Installation

```bash
# Install dependencies
npm install

# Setup Solana
solana-keygen new
solana config set --url localnet

# Setup Anchor
anchor build

# Start backend
cd backend
npm install
npm run dev

# Start frontend
cd frontend
npm install
npm run dev
```

## Project Structure

```
.
├── programs/          # Solana programs
│   ├── space-core/   # Core prediction market logic
│   ├── space-token/  # $SPACE token program
│   └── space-oracle/ # Oracle integration
├── backend/          # API server
│   ├── src/
│   │   ├── routes/   # API routes
│   │   ├── services/ # Business logic
│   │   ├── models/   # Database models
│   │   └── utils/    # Utilities
│   └── tests/
├── frontend/         # Web application
│   ├── src/
│   │   ├── components/
│   │   ├── pages/
│   │   ├── hooks/
│   │   └── utils/
│   └── public/
└── shared/           # Shared types
```

## Documentation

See [docs.into.space](https://docs.into.space) for detailed documentation on concepts and features.

## License

MIT







