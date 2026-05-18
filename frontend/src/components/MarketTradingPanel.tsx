import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import Image from 'next/image';
import { useWallet, useConnection } from '@solana/wallet-adapter-react';
import { useSpaceProgram } from '@/hooks/useSpaceProgram';
import { useAuth } from '@/context/AuthContext';
import { useMarketPriceWebSocket, useOrderBookWebSocket } from '@/hooks/useOrderBookWebSocket';
import { useSharedPositions } from '@/context/PositionsContext';
import { Market } from '@/types/market';
import { USDC_MINT, USDC_DECIMALS, usdcToLamports, humanToLamports, getYesMintPDA, getMarketPDA } from '@/utils/solana';

// Share mints are always 6 decimals on-chain regardless of the market's quote
// token. `quantity` passed to the program and share-denominated balances read
// back from it are in 6-decimal base units. The program scales share → quote
// internally using market.quote_decimals, so the frontend MUST send shares
// unscaled. (Quote amounts — margin, USDC-amount for market buy — still use
// quoteDecimals.)
const SHARE_DECIMALS = 6;
const SHARE_UNIT = 1_000_000;
import { getAccount, getAssociatedTokenAddress } from '@solana/spl-token';
import { PublicKey } from '@solana/web3.js';
import axios from 'axios';
import { formatNumber } from '@/types/formateNumbers';

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001';

interface MarketTradingPanelProps {
  market: Market;
  onOrderPlaced?: () => void;
  selectedOutcomeId?: number;
  selectedTokenType?: 'yes' | 'no';
  onTokenTypeChange?: (tokenType: 'yes' | 'no') => void;
}

export function MarketTradingPanel({ market, onOrderPlaced, selectedOutcomeId, selectedTokenType, onTokenTypeChange }: MarketTradingPanelProps) {
  const { publicKey, connected } = useWallet();
  const { connection } = useConnection();
  const { isAuthenticated } = useAuth();
  const { placeBuyOrder, placeSellOrder, placeMarketOrder, isReady: programReady, loading: programLoading, program } = useSpaceProgram();
  const { positions: sharedPositions } = useSharedPositions();

  // Determine if this is a multi-outcome market
  const isMultiOutcome = (market?.outcomes?.length ?? 0) > 2;
  const numOutcomes = market?.outcomes?.length ?? 2;

  // Resolve the market's quote token. Defaults to USDC so legacy markets keep working.
  const quoteMint = useMemo(
    () => (market?.quoteMint ? new PublicKey(market.quoteMint) : USDC_MINT),
    [market?.quoteMint],
  );
  const quoteDecimals = market?.quoteDecimals ?? USDC_DECIMALS;
  const quoteSymbol = market?.quoteSymbol ?? 'USDC';
  const quoteUnit = useMemo(() => Math.pow(10, quoteDecimals), [quoteDecimals]);

  // Order state
  const [orderSide, setOrderSide] = useState<'buy' | 'sell'>('buy');
  const [activeOutcomeId, setActiveOutcomeId] = useState<number>(selectedOutcomeId ?? 0);
  const [tokenType, setTokenType] = useState<'yes' | 'no'>('yes'); // YES or NO shares for multi-outcome
  const [amount, setAmount] = useState(0); // Margin amount in USDC
  const [leverageEnabled, setLeverageEnabled] = useState(true);
  const [leverage, setLeverage] = useState(2);
  const [orderType, setOrderType] = useState<'market' | 'limit'>('market'); // Default to market
  const [limitPrice, setLimitPrice] = useState<number>(0); // Price in cents (1-100)
  const [limitPriceInitialized, setLimitPriceInitialized] = useState(false); // Track if limit price has been initially set
  const [isPriceInputFocused, setIsPriceInputFocused] = useState(false); // Track if user is editing price
  const [userHasEditedPrice, setUserHasEditedPrice] = useState(false); // Track if user has manually edited price - stops auto-fill
  const [slippage, setSlippage] = useState<number>(5); // Slippage percentage (1-100, default 5%)

  // Sync activeOutcomeId and tokenType with parent props when they change
  useEffect(() => {
    if (selectedOutcomeId !== undefined) {
      setActiveOutcomeId(selectedOutcomeId);
    }
  }, [selectedOutcomeId]);

  useEffect(() => {
    if (selectedTokenType !== undefined) {
      setTokenType(selectedTokenType);
    }
  }, [selectedTokenType]);

  // Helper: get outcome label for the active outcome
  const rawOutcomeLabel = market?.outcomes?.[activeOutcomeId]?.label ?? `Outcome ${activeOutcomeId}`;
  const activeOutcomeLabel = isMultiOutcome && tokenType === 'no'
    ? `NO(${rawOutcomeLabel})`
    : rawOutcomeLabel;

  // Execution state
  const [orderLoading, setOrderLoading] = useState(false);
  const [orderError, setOrderError] = useState<string | null>(null);
  const [orderSuccess, setOrderSuccess] = useState<string | null>(null);

  // Balance state
  const [userUsdcBalance, setUserUsdcBalance] = useState<number | null>(null);
  const [checkingBalance, setCheckingBalance] = useState(false);
  const [spotBalance, setSpotBalance] = useState<number>(0); // Spot balance in shares (for selected outcome)
  const [checkingSpotBalance, setCheckingSpotBalance] = useState(false);
  const checkSpotBalanceRef = useRef<(() => Promise<void>) | null>(null);

  // Get live price from WebSocket for the active outcome
  const { price: liveActivePrice, loading: activePriceLoading } = useMarketPriceWebSocket(market?.id || '', activeOutcomeId);

  // For binary markets, also fetch the complementary outcome price for the YES/NO toggle display
  const complementaryOutcomeId = activeOutcomeId === 0 ? 1 : 0;
  const { price: liveComplementaryPrice, loading: complementaryPriceLoading } = useMarketPriceWebSocket(
    !isMultiOutcome ? (market?.id || '') : '', // Only fetch for binary markets
    complementaryOutcomeId
  );

  // Get orderbook data for the active outcome
  // Always filter by tokenType — binary markets use outcome 0 with tokenType 'yes'/'no'
  // Multi-outcome markets use the selected outcomeId with tokenType filter
  // Binary: activeOutcomeId 0 = YES, 1 = NO (mapped to tokenType on outcome 0)
  const activeTokenType: 'yes' | 'no' = isMultiOutcome ? tokenType : (activeOutcomeId === 0 ? 'yes' : 'no');
  const { orderBook: activeOrderBook } = useOrderBookWebSocket(
    market?.id || '', isMultiOutcome ? activeOutcomeId : 0, 20, activeTokenType
  );
  // For binary markets, fetch complementary orderbook (opposite token type on same outcome 0)
  const complementaryTokenType: 'yes' | 'no' = activeOutcomeId === 0 ? 'no' : 'yes';
  const { orderBook: complementaryOrderBook } = useOrderBookWebSocket(
    !isMultiOutcome ? (market?.id || '') : '',
    0, // Binary: always outcome 0
    20,
    complementaryTokenType
  );

  // Best ask = lowest sell price (what buyers pay)
  // Best bid = highest buy price (what sellers receive)
  const activeBestAsk = activeOrderBook?.asks?.[0]?.price ?? null;
  const activeBestBid = activeOrderBook?.bids?.[0]?.price ?? null;
  const complementaryBestAsk = complementaryOrderBook?.asks?.[0]?.price ?? null;
  const complementaryBestBid = complementaryOrderBook?.bids?.[0]?.price ?? null;

  // Use market data price as fallback if WebSocket hasn't loaded yet
  const marketActivePrice = market?.outcomes?.[activeOutcomeId]?.share_price
    ? Math.round(market.outcomes[activeOutcomeId].share_price * 100) // Convert to basis points
    : null;
  const marketComplementaryPrice = market?.outcomes?.[complementaryOutcomeId]?.share_price
    ? Math.round(market.outcomes[complementaryOutcomeId].share_price * 100) // Convert to basis points
    : null;

  // Mid prices (fallback for general display)
  const activePrice = liveActivePrice ?? marketActivePrice ?? 5000;
  const complementaryPrice = liveComplementaryPrice ?? marketComplementaryPrice ?? (10000 - activePrice);

  // Get the appropriate price based on outcome ID and order side:
  // BUY: Show best ASK (what you'll pay to buy)
  // SELL: Show best BID (what you'll receive when selling)
  const getDisplayPriceForOutcome = (outcomeId: number, side: 'buy' | 'sell') => {
    const isActive = outcomeId === activeOutcomeId;
    const bestAsk = isActive ? activeBestAsk : complementaryBestAsk;
    const bestBid = isActive ? activeBestBid : complementaryBestBid;
    const midPrice = isActive ? activePrice : complementaryPrice;
    if (side === 'buy') {
      return bestAsk ?? midPrice;
    } else {
      return bestBid ?? midPrice;
    }
  };

  const priceLoading = activePriceLoading || (!isMultiOutcome && complementaryPriceLoading);

  // Initialize limit price ONLY ONCE when first loading limit order
  // Once user has edited the price, never auto-fill again
  useEffect(() => {
    // Only auto-fill if:
    // 1. It's a limit order
    // 2. Price is loaded
    // 3. User hasn't manually edited the price yet
    // 4. Price hasn't been initialized yet
    if (orderType === 'limit' && !priceLoading && !userHasEditedPrice && !limitPriceInitialized) {
      const displayPrice = getDisplayPriceForOutcome(activeOutcomeId, orderSide);
      const currentPriceCents = displayPrice / 100;
      // Clamp to 1-100 cents range
      const clampedPrice = Math.max(1, Math.min(100, currentPriceCents));
      setLimitPrice(clampedPrice);
      setLimitPriceInitialized(true);
    }
  }, [orderType, activeOutcomeId, orderSide, activeBestAsk, activeBestBid, activePrice, priceLoading, limitPriceInitialized, userHasEditedPrice]);
  
  // Reset flags when switching order types
  useEffect(() => {
    if (orderType === 'market') {
      setLimitPriceInitialized(false);
      setUserHasEditedPrice(false); // Reset so next time they switch to limit, they get auto-fill
    }
  }, [orderType]);

  // Check USDC balance
  useEffect(() => {
    if (!connected || !publicKey) {
      setUserUsdcBalance(null);
      return;
    }

    const checkBalance = async () => {
      setCheckingBalance(true);
      try {
        const userUsdcATA = await getAssociatedTokenAddress(quoteMint, publicKey);
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
  }, [connected, publicKey, connection, quoteMint]);

  // Check position balance for selected outcome - runs in both buy and sell modes
  useEffect(() => {
    if (!connected || !publicKey || !market) {
      setSpotBalance(0);
      return;
    }

    // market.id is the market PDA (PublicKey), use it directly
    // Also check for marketAddress field (might exist in API response)
    let marketPDA: PublicKey | null = null;
    try {
      console.log('[MarketTradingPanel] Getting market PDA:', {
        marketId: market.id,
        hasMarketAddress: !!(market as any).marketAddress,
        marketAddress: (market as any).marketAddress,
      });
      
      // Try marketAddress first (if it exists in API response)
      const marketAddress = (market as any).marketAddress;
      if (marketAddress) {
        marketPDA = new PublicKey(marketAddress);
        console.log('[MarketTradingPanel] Using marketAddress from API:', marketPDA.toString());
      } else if (market.id && typeof market.id === 'string' && market.id.length > 30) {
        // market.id is likely the market PDA (PublicKey string)
        marketPDA = new PublicKey(market.id);
        console.log('[MarketTradingPanel] Using market.id as market PDA:', marketPDA.toString());
      } else {
        // Fallback: try to derive from creator and marketId
        if (market.creator) {
          const creatorPubkey = new PublicKey(market.creator);
          const marketIdFromApi = (market as any).marketId;
          
          if (marketIdFromApi !== undefined && marketIdFromApi !== null) {
            const marketIdNum = typeof marketIdFromApi === 'number' ? marketIdFromApi : parseInt(marketIdFromApi.toString(), 10);
            if (!isNaN(marketIdNum)) {
              const [derivedMarketPDA] = getMarketPDA(creatorPubkey, marketIdNum);
              marketPDA = derivedMarketPDA;
              console.log('[MarketTradingPanel] Derived market PDA from creator and marketId:', marketPDA.toString());
            }
          }
        }
      }
    } catch (e: any) {
      console.error('[MarketTradingPanel] Error getting market PDA:', e);
      console.error('[MarketTradingPanel] Market object:', {
        id: market.id,
        creator: market.creator,
        title: market.title,
        marketAddress: (market as any).marketAddress,
        marketId: (market as any).marketId,
      });
      setSpotBalance(0);
      return;
    }

    if (!marketPDA) {
      console.warn('[MarketTradingPanel] Could not get market PDA');
      setSpotBalance(0);
      return;
    }

    const marketPDAStr = marketPDA.toString();

    const checkSpotBalance = () => {
      setCheckingSpotBalance(true);
      try {
        // Use shared positions from context (no API call)
        // Binary: both YES and NO use outcomeId=0, differentiated by tokenType
        // Multi-outcome: use activeOutcomeId, also filter by tokenType
        const posOutcomeId = isMultiOutcome ? activeOutcomeId : 0;
        const userPosition = sharedPositions.find((p: any) =>
          p.market === marketPDAStr &&
          p.outcomeId === posOutcomeId &&
          (p.positionType === 0 || p.leverage === 1) &&
          (p.isOpen !== false) &&
          (p.tokenType || 'yes') === activeTokenType
        );

        if (userPosition) {
          // position.shares is stored in share base units (6 decimals) on-chain
          // regardless of the market's quote token — divide by SHARE_UNIT.
          const shares = Number(userPosition.shares) / SHARE_UNIT;
          setSpotBalance(shares > 0 ? shares : 0);
        } else {
          setSpotBalance(0);
        }
      } catch (e) {
        console.error('Error checking spot balance:', e);
        setSpotBalance(0);
      } finally {
        setCheckingSpotBalance(false);
      }
    };

    checkSpotBalanceRef.current = checkSpotBalance;
    checkSpotBalance();
  }, [connected, publicKey, market, activeOutcomeId, activeTokenType, sharedPositions]);

  // Clear messages after 5 seconds
  useEffect(() => {
    if (orderSuccess || orderError) {
      const timer = setTimeout(() => {
        setOrderSuccess(null);
        setOrderError(null);
      }, 5000);
      return () => clearTimeout(timer);
    }
  }, [orderSuccess, orderError]);

  // Calculate trading values
  // Get current price in cents - use best ask for BUY, best bid for SELL
  // This matches centralized exchange behavior
  const currentPriceCents = getDisplayPriceForOutcome(activeOutcomeId, orderSide) / 100;
  // For limit orders, use limitPrice; for market orders, use current price
  const priceCents = orderType === 'limit' && limitPrice > 0 ? limitPrice : currentPriceCents;
  
  // For LIMIT orders: amount = shares
  // For MARKET orders: amount = total dollar value
  // For SELL orders: no leverage (always 1x)
  const currentLeverage = (orderSide === 'buy' && leverageEnabled) ? leverage : 1;
  
  let shares: number;
  let totalValue: number;
  let marginAmount: number;
  let borrowedAmount: number;
  let positionValue: number;
  
  if (orderType === 'limit') {
    // Limit order: amount = shares
    // Leverage multiplies position value, margin increases with leverage
    shares = amount;
    totalValue = shares * (priceCents / 100);
    marginAmount = orderSide === 'buy' ? totalValue / currentLeverage : totalValue;
    borrowedAmount = orderSide === 'buy' && currentLeverage > 1 ? totalValue - marginAmount : 0;
    positionValue = totalValue;
  } else if (orderSide === 'sell') {
    // Market sell order: amount = shares to sell
    shares = amount;
    totalValue = priceCents > 0 ? shares * (priceCents / 100) : 0;
    marginAmount = 0;
    borrowedAmount = 0;
    positionValue = totalValue; // USD the user will receive
  } else {
    // Market buy order: amount = dollar investment (margin)
    // Leverage multiplies shares, margin stays fixed
    const margin = amount; // Margin is the invested amount (fixed)
    const notional = margin * currentLeverage; // Notional = margin * leverage
    shares = notional > 0 && priceCents > 0 ? (notional / (priceCents / 100)) : 0;
    marginAmount = margin; // Margin stays the same regardless of leverage
    borrowedAmount = currentLeverage > 1 ? notional - marginAmount : 0;
    totalValue = notional; // Total value = notional (for display)
    positionValue = notional;
  }
  
  // On-chain enforces a 20% initial margin floor (INITIAL_MARGIN_BPS = 2000)
  // For leverage > 5x, the actual deduction = notional * 20% (higher than notional / leverage)
  const INITIAL_MARGIN_RATE = 0.20; // 20% = 2000 bps
  const minMarginOnChain = positionValue * INITIAL_MARGIN_RATE;
  const actualMarginDeducted = Math.max(marginAmount, minMarginOnChain);
  const hasMarginFloor = currentLeverage > 5 && orderSide === 'buy' && actualMarginDeducted > marginAmount;

  // Calculate potential profit (for display)
  const toWin = shares > 0 && orderSide === 'buy'
    ? (shares * (100 - priceCents) / 100).toFixed(2)
    : '0.00';

  // Handle placing orders
  const handlePlaceOrder = useCallback(async () => {
    if (!connected || !publicKey) {
      setOrderError('Please connect your wallet first');
      return;
    }

    if (!isAuthenticated) {
      setOrderError('Please sign in to place orders');
      return;
    }

    if (!programReady) {
      setOrderError('Program not ready. Please wait...');
      return;
    }

    if (!market) {
      setOrderError('Market not found');
      return;
    }

    if (amount <= 0) {
      setOrderError('Please enter a valid amount');
      return;
    }

    // Block orders when no liquidity on the opposite side
    if (orderSide === 'buy' && activeBestAsk === null) {
      setOrderError('No sell orders in the order book. Cannot place buy order.');
      return;
    }
    if (orderSide === 'sell' && activeBestBid === null) {
      setOrderError('No buy orders in the order book. Cannot place sell order.');
      return;
    }

    // Check balance for buy orders
    // For sell orders, check token balance instead
    if (orderSide === 'buy') {
      let requiredMargin: number;
      if (orderType === 'limit') {
        // Limit order: amount = shares, calculate margin
        // Leverage multiplies position value, so margin = totalValue / leverage
        const priceInDollars = (orderType === 'limit' && limitPrice > 0
          ? Math.round(limitPrice * 100)
          : activePrice) / 10000;
        const totalValue = amount * priceInDollars; // shares * price
        requiredMargin = totalValue / currentLeverage;
      } else {
        // Market order: amount = margin (dollar investment)
        // Leverage multiplies shares, margin stays fixed at the invested amount
        requiredMargin = amount; // Margin is the invested amount itself
      }
      // On-chain enforces 20% initial margin floor for leverage > 5x
      const notionalValue = orderType === 'limit' ? (amount * ((limitPrice > 0 ? Math.round(limitPrice * 100) : activePrice) / 10000)) : amount * currentLeverage;
      const minMarginFloor = notionalValue * 0.20;
      const effectiveMargin = Math.max(requiredMargin, minMarginFloor);
      const requiredMarginLamports = humanToLamports(effectiveMargin, quoteDecimals);
      if (userUsdcBalance !== null && userUsdcBalance < requiredMarginLamports) {
        const marginFloorNote = currentLeverage > 5 ? ` (20% margin floor applies at ${currentLeverage}x)` : '';
        if (orderType === 'limit') {
          setOrderError(`Insufficient ${quoteSymbol}. Required margin: ${effectiveMargin.toFixed(2)} ${quoteSymbol}${marginFloorNote} (for ${amount} shares at ${currentLeverage}x), Available: ${(userUsdcBalance / quoteUnit).toFixed(2)} ${quoteSymbol}`);
        } else {
          setOrderError(`Insufficient ${quoteSymbol}. Required margin: ${effectiveMargin.toFixed(2)} ${quoteSymbol}${marginFloorNote} (for ${amount.toFixed(2)} ${quoteSymbol} position at ${currentLeverage}x), Available: ${(userUsdcBalance / quoteUnit).toFixed(2)} ${quoteSymbol}`);
        }
        return;
      }
    }
    
    // Validate limit price for limit orders
    if (orderType === 'limit') {
      if (limitPrice < 1 || limitPrice > 100) {
        setOrderError('Please enter a valid limit price between 1¢ and 100¢');
        return;
      }
    }

    setOrderLoading(true);
    setOrderError(null);
    setOrderSuccess(null);

    try {
      const orderId = Date.now();
      const currentLeverage = (orderSide === 'buy' && leverageEnabled) ? leverage : 1;
      // Binary markets: always use outcomeId 0. YES/NO are token types on the same outcome.
      // Multi-outcome markets: use the selected outcomeId directly.
      const outcomeId = isMultiOutcome ? activeOutcomeId : 0;

      const priceInBps = orderType === 'limit' && limitPrice > 0
        ? Math.round(limitPrice * 100)
        : activePrice;
      
      let quantity: number;
      if (orderSide === 'sell') {
        // Sell: `amount` is a share count → convert with SHARE_DECIMALS.
        quantity = humanToLamports(amount, SHARE_DECIMALS);
      } else {
        if (orderType === 'limit') {
          // Limit buy: `amount` is a share count → SHARE_DECIMALS.
          quantity = humanToLamports(amount, SHARE_DECIMALS);
        } else {
          // Market buy: `amount` is a quote value; quantity is computed from
          // the aggressive price on-chain. Value here is unused by the market
          // buy path (overridden by usdcAmountLamports below) but kept in
          // share units for any fallback display math.
          quantity = humanToLamports(amount, SHARE_DECIMALS);
        }
      }

      let result;

      if (orderType === 'market') {
        if (orderSide === 'buy') {
          // Market buy orders: pass USDC amount, quantity will be calculated based on market price
          const usdcAmountLamports = humanToLamports(amount, quoteDecimals);
          console.log(`[MarketTradingPanel] Placing market buy order: amount=$${amount}, usdcAmountLamports=${usdcAmountLamports}, expectedShares=${(amount / (priceCents / 100)).toFixed(2)}`);
          
          result = await placeMarketOrder({
            market: market.id,
            outcomeId,
            side: 0, // Buy
            usdcAmount: usdcAmountLamports,
            maxSlippageBps: slippage * 100,
            leverage: currentLeverage,
            orderId,
            tokenType: activeTokenType,
            quoteMint: market.quoteMint,
            quoteDecimals,
          });

          console.log(`[MarketTradingPanel] Market order result:`, {
            pendingOrder: result.pendingOrder,
            calculatedQuantity: (result as any).calculatedQuantity,
            calculatedQuantityShares: (result as any).calculatedQuantity ? ((result as any).calculatedQuantity / SHARE_UNIT).toFixed(2) : 'N/A',
            aggressivePrice: (result as any).aggressivePrice,
          });
        } else {
          // Market sell orders: pass quantity (shares)
          result = await placeMarketOrder({
            market: market.id,
            outcomeId,
            side: 1, // Sell
            usdcAmount: 0, // Not used for sell orders
            quantity: quantity, // Shares to sell
            maxSlippageBps: slippage * 100, // Convert percentage to basis points (5% = 500 bps)
            leverage: currentLeverage,
            orderId,
            numOutcomes,
            tokenType: activeTokenType, // Always filter by token type (binary='yes', multi=selected)
          });
        }
      } else {
        if (orderSide === 'buy') {
          result = await placeBuyOrder({
            market: market.id,
            outcomeId,
            price: priceInBps,
            quantity: quantity,
            leverage: currentLeverage,
            orderId,
            quoteMint: market.quoteMint,
          });
        } else {
          result = await placeSellOrder({
            market: market.id,
            outcomeId,
            price: priceInBps,
            quantity: quantity,
            leverage: currentLeverage,
            orderId,
            numOutcomes,
            tokenType: activeTokenType, // Always filter by token type (binary='yes', multi=selected)
          });
        }
      }

      // Track order in backend - CRITICAL: Must include on_chain_order and order_id
      try {
        const backendEndpoint = orderType === 'market' 
          ? `${API_URL}/api/v1/orders/market`
          : `${API_URL}/api/v1/orders/limit`;

        // For market buy orders, use the CALCULATED QUANTITY from the on-chain order
        // The backend treats 'size' as number of shares, not USDC amount!
        // result.calculatedQuantity contains the correctly calculated shares based on price
        const sizeToSend = (orderType === 'market' && orderSide === 'buy')
          ? ((result as any).calculatedQuantity || humanToLamports(amount, SHARE_DECIMALS)) // Use calculated shares, fallback to amount
          : quantity; // Quantity (shares) for limit orders and market sell orders

        console.log(`[MarketTradingPanel] Sending to backend: size=${sizeToSend} (${sizeToSend / SHARE_UNIT} shares), calculatedQuantity=${(result as any).calculatedQuantity}`);

        // Ensure on-chain order data is present
        if (!result.pendingOrder) {
          throw new Error('Missing pendingOrder from on-chain transaction result');
        }
        if (!orderId) {
          throw new Error('Missing orderId');
        }

        const backendResponse = await axios.post(backendEndpoint, {
          market_id: market.id,
          outcome_id: outcomeId,
          side: orderSide,
          size: sizeToSend,
          leverage: currentLeverage,
          price: orderType === 'limit' ? priceInBps : ((result as any).bestAskPrice || (result as any).aggressivePrice), // Use actual ask price, not slippage-inflated
          on_chain_order: result.pendingOrder,
          order_id: orderId,
          num_outcomes: numOutcomes,
          token_type: activeTokenType, // YES/NO token type for order book separation
        }, {
          headers: {
            'x-pubkey': publicKey.toBase58(),
          },
        });

        // Verify the order was stored with on-chain data
        if (backendResponse.data?.order) {
          const storedOrder = backendResponse.data.order;
          if (!storedOrder.on_chain_order || !storedOrder.order_id) {
            console.warn('Order stored but missing on-chain data. Attempting to update...');
            // Try to update the order with on-chain data
            try {
              await axios.post(`${API_URL}/api/v1/orders/${backendResponse.data.order_id}/update-onchain`, {
                on_chain_order: result.pendingOrder,
                order_id: orderId,
              }, {
                headers: {
                  'x-pubkey': publicKey.toBase58(),
                },
              });
            } catch (updateErr) {
              console.error('Failed to update order with on-chain data:', updateErr);
            }
          }
        }
      } catch (backendErr: any) {
        console.error('Failed to track order in backend:', backendErr);
        // This is critical - if backend tracking fails, the order won't be matchable
        // Show error to user but don't fail the transaction
        setOrderError(`Order placed on-chain but failed to track in backend: ${backendErr.message}. Please contact support.`);
      }

      // Trigger order matching immediately after placing order
      try {
        const matchResponse = await axios.post(
          `${API_URL}/api/v1/orderbook/${market.id}/${outcomeId}/match`,
          {},
          { timeout: 30000 }
        );
        
        if (matchResponse.data.matches > 0) {
          setOrderSuccess(
            `${orderSide === 'buy' ? 'Buy' : 'Sell'} order matched and executed! ` +
            `${matchResponse.data.matches} pair(s) filled.`
          );
        } else {
          setOrderSuccess(
            `${orderSide === 'buy' ? 'Buy' : 'Sell'} order placed in order book. ` +
            `Waiting for a matching ${orderSide === 'buy' ? 'seller' : 'buyer'}...`
          );
        }
      } catch (matchError: any) {
        // Don't fail the order placement if matching fails - periodic matching will handle it
        setOrderSuccess(
          `${orderSide === 'buy' ? 'Buy' : 'Sell'} order placed! ` +
          `Matching will happen automatically.`
        );
      }

      // Poll for position balance update after any order (buy or sell)
      if (checkSpotBalanceRef.current) {
        // Refresh position balance immediately after a short delay
        setTimeout(() => {
          if (checkSpotBalanceRef.current) {
            checkSpotBalanceRef.current();
          }
        }, 2000);

        // Poll for position balance updates (order might execute quickly)
        let pollCount = 0;
        const maxPolls = 10; // Poll for up to 20 seconds (2s * 10)

        const pollForBalance = async () => {
          pollCount++;

          if (checkSpotBalanceRef.current) {
            await checkSpotBalanceRef.current();
          }

          if (pollCount >= maxPolls) {
            return; // Stop polling
          }

          // Continue polling
          setTimeout(pollForBalance, 2000);
        };

        // Start polling after initial delay
        setTimeout(pollForBalance, 3000);
      }

      setAmount(0);
      onOrderPlaced?.();

      // Trigger position refresh after all orders (positions may have changed)
      // Buy orders create new positions when matched, sell orders modify/close them
      // Use multiple retries to ensure the UI catches up with backend updates
      const refreshDelays = [500, 2000, 4000, 8000, 15000];
      refreshDelays.forEach(delay => {
        setTimeout(() => {
          window.dispatchEvent(new CustomEvent('positions-refresh'));
        }, delay);
      });
      
    } catch (err: any) {
      console.error('Order placement error:', err);
      
      if (err?.isUserRejection || err?.name === 'UserRejectionError' || 
          err?.message?.toLowerCase().includes('rejected')) {
        setOrderError('Transaction cancelled');
      } else {
        setOrderError(err?.message || 'Failed to place order. Please try again.');
      }
    } finally {
      setOrderLoading(false);
    }
  }, [
    connected, publicKey, isAuthenticated, programReady, market, amount,
    activeOutcomeId, activePrice, orderSide, orderType, limitPrice,
    leverage, leverageEnabled, slippage, placeMarketOrder, placeBuyOrder, placeSellOrder,
    userUsdcBalance, onOrderPlaced, tokenType, isMultiOutcome
  ]);

  // Guard: don't render trading UI for non-active or expired markets
  const marketStatus = typeof market?.status === 'string' ? parseInt(market.status) : (market?.status || 0);
  const isExpired = market?.end_date && new Date(market.end_date) < new Date();
  if (marketStatus !== 0 || isExpired) {
    const statusLabel = marketStatus === 0 && isExpired
      ? 'Ended - Awaiting Resolution'
      : (['Active', 'Pending Resolution', 'Disputed', 'Resolved', 'Invalid'][marketStatus] || 'Inactive');
    return (
      <div className="bg-[#141414] rounded-xl p-5" data-trading-panel>
        <div className="p-4 bg-gray-500/10 border border-gray-500/30 rounded-lg text-center">
          <p className="text-sm text-gray-400">Trading is disabled</p>
          <p className="text-xs text-gray-500 mt-1">Market status: {statusLabel}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="bg-[#141414] rounded-xl overflow-hidden" data-trading-panel>

              {/* Outcome Selector */}
        {isMultiOutcome && (
          <>
            {/* Selected outcome display with photo */}
            {(() => {
              const selectedOutcome = market.outcomes?.[activeOutcomeId];
              if (!selectedOutcome) return null;
              return (
                <div className="flex items-center gap-3 px-5 pt-4">
                  {selectedOutcome.imageUrl ? (
                    <div className="w-14 h-14 rounded-lg overflow-hidden flex-shrink-0 relative">
                      <Image src={selectedOutcome.imageUrl} alt={selectedOutcome.label} fill className="object-cover" />
                    </div>
                  ) : (
                    <div className="w-14 h-14 rounded-lg bg-[#262626] flex items-center justify-center flex-shrink-0">
                      <span className="text-white text-sm font-bold">
                        {selectedOutcome.label.charAt(0).toUpperCase()}
                      </span>
                    </div>
                  )}
                  <div className="min-w-0 flex flex-col">
                    {selectedOutcome.subtitle && (
                      <p className="text-[#737373] text-xs truncate">{selectedOutcome.subtitle}</p>
                    )}
                    <p className="text-white text-sm font-semibold truncate">{selectedOutcome.label}</p>
                  </div>
                </div>
              );
            })()}
          </>
        )}

      {/* Buy/Sell + Market Tabs */}
      <div className="flex items-center justify-between border-b border-[#262626]">
        <div className="flex px-4">
          <button
            onClick={() => setOrderSide('buy')}
            className={`px-4 py-3 text-sm font-semibold transition-colors ${orderSide === 'buy' ? 'text-white border-b-2 border-white' : 'text-[#909090]'}`}
          >
            Buy
          </button>
          <button
            onClick={() => setOrderSide('sell')}
            className={`px-4 py-3 text-sm font-semibold transition-colors ${orderSide === 'sell' ? 'text-white border-b-2 border-white' : 'text-[#909090]'}`}
          >
            Sell
          </button>
        </div>
        <div className="relative group ">
          <button 
            className="px-4 py-2 mr-2 font-semibold text-sm text-[#909090] flex items-center gap-1 hover:text-white transition-colors"
            onClick={() => setOrderType(orderType === 'market' ? 'limit' : 'market')}
          >
            {orderType === 'market' ? 'Market' : 'Limit'}
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
            </svg>
          </button>
        </div>
      </div>

      <div className="p-5 space-y-5">
        {/* Balance Display */}
        {connected && (
          <>
            <div className="flex justify-between items-center text-sm p-3 bg-[#1a1a1a] rounded-lg">
              <span className="text-gray-400">{quoteSymbol} Balance</span>
              <span className="text-white font-semibold">
                {checkingBalance ? '...' : userUsdcBalance !== null ? `${formatNumber((userUsdcBalance / quoteUnit).toFixed(2))} ${quoteSymbol}` : `0.00 ${quoteSymbol}`}
              </span>
            </div>
            {/* Spot Position Balance - Show in both buy and sell modes when user has shares */}
            {(orderSide === 'sell' || spotBalance > 0) && (
              <div className="flex justify-between items-center text-sm p-3 bg-[#1a1a1a] rounded-lg">
                <span className="text-gray-400">Spot Position - {activeOutcomeLabel}</span>
                <span className="text-white font-semibold">
                  {checkingSpotBalance ? '...' : `${spotBalance.toFixed(2)} shares`}
                </span>
              </div>
            )}
          </>
        )}

        {/* Outcome Selector */}
        {isMultiOutcome ? (
          <>
            {/* YES / NO token toggle */}
            <div className="flex gap-2">
              <button
                onClick={() => { setTokenType('yes'); onTokenTypeChange?.('yes'); }}
                className={`flex-1 py-3 rounded-lg text-sm font-semibold transition-all ${
                  tokenType === 'yes'
                    ? 'bg-[#5CDB2A] text-white'
                    : 'bg-[#5cdb2a1c] text-[#5CDB2A]'
                }`}
              >
                YES ({market.outcomes?.[activeOutcomeId]?.label})
              </button>
              <button
                onClick={() => { setTokenType('no'); onTokenTypeChange?.('no'); }}
                className={`flex-1 py-3 rounded-lg text-sm font-semibold transition-all ${
                  tokenType === 'no'
                    ? 'bg-[#ed4228] text-white'
                    : 'bg-[#ED422814] text-[#ed4228]'
                }`}
              >
                NO ({market.outcomes?.[activeOutcomeId]?.label})
              </button>
            </div>
          </>
        ) : (
          /* Binary market: YES/NO toggle buttons */
          <div className="flex gap-3">
            <button
              onClick={() => {
                setActiveOutcomeId(0);
                // Only auto-fill if user hasn't manually edited the price
                if (!userHasEditedPrice) {
                  const displayPrice = getDisplayPriceForOutcome(0, orderSide);
                  if (orderType === 'limit' && !priceLoading && displayPrice > 0) {
                    const priceCentsVal = displayPrice / 100;
                    const clampedPrice = Math.max(1, Math.min(100, priceCentsVal));
                    setLimitPrice(clampedPrice);
                    setLimitPriceInitialized(true);
                  }
                }
              }}
              className={`flex-1 py-4 rounded-lg text-sm font-semibold transition-all ${activeOutcomeId === 0
                  ? 'bg-[#5CDB2A] text-white'
                  : 'bg-[#5cdb2a1c] text-[#5CDB2A]'
                }`}
            >
              {market?.outcomes?.[0]?.label || 'Yes'} {(getDisplayPriceForOutcome(0, orderSide) / 100).toFixed(0)}{'\u00A2'}
            </button>
            <button
              onClick={() => {
                setActiveOutcomeId(1);
                // Only auto-fill if user hasn't manually edited the price
                if (!userHasEditedPrice) {
                  const displayPrice = getDisplayPriceForOutcome(1, orderSide);
                  if (orderType === 'limit' && !priceLoading && displayPrice > 0) {
                    const priceCentsVal = displayPrice / 100;
                    const clampedPrice = Math.max(1, Math.min(100, priceCentsVal));
                    setLimitPrice(clampedPrice);
                    setLimitPriceInitialized(true);
                  }
                }
              }}
              className={`flex-1 py-4 rounded-lg text-sm font-semibold transition-all ${activeOutcomeId === 1
                  ? 'bg-[#ed4228] text-white'
                  : 'bg-[#ED422814] text-[#ed4228]'
                }`}
            >
              {market?.outcomes?.[1]?.label || 'No'} {(getDisplayPriceForOutcome(1, orderSide) / 100).toFixed(0)}{'\u00A2'}
            </button>
          </div>
        )}

        {/* Limit Price */}
        {orderType === 'limit' && (
          <div>
            <label className="text-xs text-[#909090] capitalize tracking-wide">Limit Price (Cents)</label>
            <div className="flex items-baseline gap-1 mt-1">
              <input
                type="text"
                inputMode="decimal"
                value={limitPrice || ''}
                onFocus={() => setIsPriceInputFocused(true)}
                onBlur={() => {
                  setIsPriceInputFocused(false);
                  // Clamp to 1-100 cents range when user leaves the field
                  if (limitPrice < 1 && limitPrice !== 0) {
                    setLimitPrice(1);
                  } else if (limitPrice > 100) {
                    setLimitPrice(100);
                  }
                }}
                onChange={(e) => {
                  const val = e.target.value.replace(/[^0-9.]/g, '');
                  // Allow any input - just like the shares input
                  const numVal = parseFloat(val) || 0;
                  setLimitPrice(numVal);
                  setLimitPriceInitialized(true);
                  setUserHasEditedPrice(true); // User has manually edited - stop auto-fill forever
                }}
                placeholder={Math.max(1, Math.min(100, currentPriceCents)).toFixed(2)}
                className="text-2xl font-bold text-white bg-transparent border-none outline-none w-20"
              />
              <span className="text-2xl font-bold text-[#909090]">¢</span>
            </div>
            <p className="text-xs text-[#606060] mt-1">
              Current: {currentPriceCents.toFixed(2)}¢
            </p>
          </div>
        )}

        {/* Amount Input - Different for Limit vs Market */}
        <div>
          <label className="text-xs text-[#909090] capitalize tracking-wide">
            {orderType === 'limit' || orderSide === 'sell' ? 'Shares' : 'Amount'}
          </label>
          <div className="flex items-baseline gap-1 mt-1">
            <input
              type="text"
              inputMode="decimal"
              value={amount || ''}
              onChange={(e) => {
                const val = e.target.value.replace(/[^0-9.]/g, '');
                setAmount(parseFloat(val) || 0);
              }}
              placeholder="0"
              className="text-4xl font-bold text-white bg-transparent border-none outline-none w-full"
            />
            <span className="text-4xl font-bold text-[#909090]">
              {orderType === 'limit' ? '' : ''}
            </span>
          </div>
          {amount > 0 && priceCents > 0 && (
            <p className="text-xs text-[#606060] mt-1">
              {orderType === 'limit' ? (
                <>{totalValue.toFixed(2)} {quoteSymbol} @ {Math.round(priceCents)}¢ per share</>
              ) : orderSide === 'sell' ? (
                <>{totalValue.toFixed(2)} {quoteSymbol} @ {Math.round(priceCents)}¢ per share</>
              ) : (
                <>{Math.floor(shares).toLocaleString()} shares @ {Math.round(priceCents)}¢ per share</>
              )}
            </p>
          )}
        </div>

        {/* Quick Amount Buttons */}
        <div className="flex gap-2">
          {[1, 20, 100].map((val) => (
            <button
              key={val}
              onClick={() => setAmount(amount + val)}
              className="px-3 py-1.5 border border-[#3B3B3B] text-white text-sm font-medium rounded-lg transition-colors hover:bg-[#262626]"
            >
              +{val}
            </button>
          ))}
          <button
            onClick={() => {
              if (orderSide === 'sell') {
                // In sell mode, use spot balance (shares)
                setAmount(spotBalance);
              } else {
                // In buy mode, use USDC balance
                setAmount(userUsdcBalance ? userUsdcBalance / quoteUnit : 0);
              }
            }}
            className="px-3 py-1.5 border border-[#3B3B3B] text-white text-sm font-medium rounded-lg transition-colors hover:bg-[#262626]"
          >
            MAX
          </button>
        </div>

        {/* Slippage - Only for Market Orders */}
        {orderType === 'market' && (
          <div>
            <label className="text-xs text-[#909090] capitalize tracking-wide">Max Slippage (%)</label>
            <div className="flex items-center gap-2 mt-1">
              <input
                type="text"
                inputMode="numeric"
                value={slippage || ''}
                onChange={(e) => {
                  const val = e.target.value.replace(/[^0-9]/g, '');
                  if (val === '') {
                    setSlippage(0);
                    return;
                  }
                  const numVal = parseInt(val, 10);
                  if (!isNaN(numVal) && numVal >= 1 && numVal <= 100) {
                    setSlippage(numVal);
                  } else if (numVal > 100) {
                    setSlippage(100);
                  }
                }}
                onBlur={() => {
                  // Ensure minimum 1% when user leaves the field
                  if (slippage < 1) {
                    setSlippage(1);
                  }
                }}
                placeholder="5"
                className="w-16 px-3 py-2 bg-[#1a1a1a] border border-[#3B3B3B] rounded-lg text-white text-sm font-medium focus:outline-none focus:border-[#5CDB2A]"
              />
              <span className="text-sm text-[#909090]">%</span>
              <div className="flex gap-1 ml-2">
                {[1, 5, 10].map((val) => (
                  <button
                    key={val}
                    onClick={() => setSlippage(val)}
                    className={`px-2 py-1 text-xs rounded transition-colors ${
                      slippage === val 
                        ? 'bg-[#5CDB2A] text-white' 
                        : 'bg-[#262626] text-[#909090] hover:bg-[#3B3B3B]'
                    }`}
                  >
                    {val}%
                  </button>
                ))}
              </div>
            </div>
            <p className="text-xs text-[#606060] mt-1">
              Max price tolerance for market orders
            </p>
          </div>
        )}

        {/* Leverage - Only for Buy Orders */}
        {orderSide === 'buy' && (
        <div>
          <div className="flex items-center justify-between mb-3">
            <label className="text-sm text-[#A3A3A3]">Leverage</label>
            <button
              onClick={() => setLeverageEnabled(!leverageEnabled)}
              className={`w-10 h-5 rounded-full transition-colors relative ${leverageEnabled ? 'bg-[#5CDB2A]' : 'bg-gray-600'}`}
            >
              <div className={`absolute top-0.5 w-4 h-4 bg-white rounded-full transition-all ${leverageEnabled ? 'left-5' : 'left-0.5'}`}></div>
            </button>
          </div>
          {leverageEnabled && (
            <div className="flex items-center gap-3">
              <div 
                className="flex items-center justify-between gap-0.5 relative w-full cursor-pointer select-none"
                onMouseDown={(e) => {
                  const rect = e.currentTarget.getBoundingClientRect();
                  const updateLeverage = (clientX: number) => {
                    const x = clientX - rect.left;
                    const percent = Math.max(0, Math.min(1, x / rect.width));
                    const newLeverage = Math.round(1 + percent * 9);
                    setLeverage(newLeverage);
                  };
                  updateLeverage(e.clientX);
                  const handleMouseMove = (moveEvent: MouseEvent) => updateLeverage(moveEvent.clientX);
                  const handleMouseUp = () => {
                    document.removeEventListener('mousemove', handleMouseMove);
                    document.removeEventListener('mouseup', handleMouseUp);
                  };
                  document.addEventListener('mousemove', handleMouseMove);
                  document.addEventListener('mouseup', handleMouseUp);
                }}
              >
                {[...Array(30)].map((_, i) => {
                  const filledDots = Math.round(((leverage - 1) / 9) * 30);
                  return (
                    <div
                      key={i}
                      className={`w-1 h-5 rounded-full ${i < filledDots ? 'bg-[#fffffd]' : 'bg-[#3B3B3B]'}`}
                    />
                  );
                })}
                <div 
                  className='z-10 w-16 absolute active:scale-105 hover:scale-105 transition-all duration-300'
                  style={{ left: `calc(${((leverage - 1) / 9) * 100}% - 30px)` }}
                  onContextMenu={(e) => e.preventDefault()}
                  draggable={false}
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
                <input
                  type="text"
                  inputMode="numeric"
                  value={leverage}
                  onChange={(e) => {
                    const val = parseInt(e.target.value.replace(/[^0-9]/g, ''), 10);
                    if (!isNaN(val)) {
                      const newLeverage = Math.max(1, Math.min(10, val));
                      setLeverage(newLeverage);
                    }
                  }}
                  className="w-6 text-white font-semibold text-right bg-transparent border-none outline-none"
                />
                <span className="text-white font-semibold">x</span>
              </div>
            </div>
          )}
        </div>
          )
        }

        {/* Order Status Messages */}
        {orderError && (
          <div className="p-3 bg-red-500/10 border border-red-500/30 rounded-xl">
            <p className="text-sm text-red-400">{orderError}</p>
          </div>
        )}
        {orderSuccess && (
          <div className="p-3 bg-green-500/10 border border-green-500/30 rounded-xl">
            <p className="text-sm text-green-400">{orderSuccess}</p>
          </div>
        )}

        {/* Buy/Sell Button */}
        <button
          onClick={handlePlaceOrder}
          disabled={orderLoading || !connected || amount <= 0 || (orderSide === 'buy' && activeBestAsk === null) || (orderSide === 'sell' && activeBestBid === null)}
          className={`w-full py-4 font-semibold rounded-xl transition-colors flex items-center justify-center gap-2 ${
            orderLoading || !connected || amount <= 0 || (orderSide === 'buy' && activeBestAsk === null) || (orderSide === 'sell' && activeBestBid === null)
              ? 'bg-[#262626] text-gray-500 cursor-not-allowed'
              : 'bg-[#ffffff] hover:bg-[#ebebeb] text-black'
          }`}
        >
          {orderLoading ? (
            <>
              <svg className="animate-spin h-5 w-5" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
              </svg>
              Processing...
            </>
          ) : !connected ? (
            'Connect Wallet'
          ) : (orderSide === 'buy' && activeBestAsk === null) ? (
            'No sell liquidity'
          ) : (orderSide === 'sell' && activeBestBid === null) ? (
            'No buy liquidity'
          ) : amount <= 0 ? (
            'Enter Amount'
          ) : (
            `${orderSide === 'buy' ? 'Buy' : 'Sell'} ${activeOutcomeLabel.toUpperCase()}`
          )}
        </button>

        {/* Order Summary */}
        <div className="space-y-3">
          <div className="flex justify-between text-sm">
            <span className="text-gray-500">Shares</span>
            <span className="text-white font-semibold">{shares.toFixed(2)}</span>
          </div>
          <div className="flex justify-between text-sm">
            <span className="text-gray-500">Position Value</span>
            <span className="text-white font-semibold">{positionValue.toFixed(2)} {quoteSymbol}</span>
          </div>
          {orderSide === 'buy' && (
            <>
              <div className="flex justify-between text-sm">
                <span className="text-gray-500">Margin Required</span>
                <span className={`font-semibold ${hasMarginFloor ? 'text-orange-400' : 'text-white'}`}>
                  {hasMarginFloor ? actualMarginDeducted.toFixed(2) : marginAmount.toFixed(2)} {quoteSymbol}
                </span>
              </div>
              {hasMarginFloor && (
                <div className="p-2 bg-orange-500/10 border border-orange-500/20 rounded-lg">
                  <p className="text-xs text-orange-400">
                    On-chain 20% initial margin floor applies at {currentLeverage}x leverage.
                    Effective leverage: 5x. Wallet will be charged {actualMarginDeducted.toFixed(2)} {quoteSymbol} instead of {marginAmount.toFixed(2)} {quoteSymbol}.
                  </p>
                </div>
              )}
              {borrowedAmount > 0 && (
                <div className="flex justify-between text-sm">
                  <span className="text-gray-500">Borrowed (from vault)</span>
                  <span className="text-yellow-400 font-semibold">{borrowedAmount.toFixed(2)} {quoteSymbol}</span>
                </div>
              )}
            </>
          )}
          {orderSide === 'sell' && (
            <div className="flex justify-between text-sm">
              <span className="text-gray-500">You Will Receive</span>
              <span className="text-white font-semibold">{positionValue.toFixed(2)} {quoteSymbol}</span>
            </div>
          )}
        </div>

        {/* To Win Section */}
        {orderSide === 'buy' && parseFloat(toWin) > 0 && (
          <div className="border-t border-[#262626] pt-6">
            <div className="flex items-center justify-between">
              <div className="flex flex-col">
                <p className="text-sm text-[#5CDB2A] font-medium">Potential Profit ({activeOutcomeLabel})</p>
                <p className="text-sm text-[#A3A3A3]">Entry Price {priceCents.toFixed(2)}{'\u00A2'}</p>
              </div>
              <p className="text-2xl font-bold text-[#5CDB2A]">${toWin}</p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

