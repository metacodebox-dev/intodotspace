import { useState, useEffect } from 'react';
import { useWallet, useConnection } from '@solana/wallet-adapter-react';
import { PublicKey } from '@solana/web3.js';
import { Market } from '@/types/market';
import { useSpaceProgram } from '@/hooks/useSpaceProgram';
import { USDC_MINT, usdcToLamports, getYesMintPDA } from '@/utils/solana';
import { getAccount, getAssociatedTokenAddress } from '@solana/spl-token';
import axios from 'axios';
import { useMarketPriceWebSocket, useOrderBookWebSocket } from '@/hooks/useOrderBookWebSocket';

interface TradingPanelProps {
  market: Market;
  outcomeId?: number;
  hideSideSelection?: boolean; // Hide side selection buttons when used in tabs
  initialOrderSide?: 'buy' | 'sell'; // Initial order side when used in tabs
  initialOutcomeSide?: 'yes' | 'no'; // Initial outcome side when used in tabs
}

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001';

const formatPrice = (price: number) => {
  return (price / 100).toFixed(2) + '%';
};

export function TradingPanel({ market, outcomeId = 0, hideSideSelection = false, initialOrderSide, initialOutcomeSide }: TradingPanelProps) {
  const { connected, publicKey } = useWallet();
  const { connection } = useConnection();
  const { placeLimitOrder, placeMarketOrder, loading: programLoading, isReady } = useSpaceProgram();
  // Order side: 'buy' = Long/Buy, 'sell' = Short/Sell
  const [orderSide, setOrderSide] = useState<'buy' | 'sell'>(initialOrderSide || 'buy');
  // Outcome: 'yes' = outcome 0, 'no' = outcome 1
  const [outcomeSide, setOutcomeSide] = useState<'yes' | 'no'>(initialOutcomeSide || (outcomeId === 0 ? 'yes' : 'no'));
  
  // Update outcome side when outcomeId changes
  useEffect(() => {
    if (!initialOutcomeSide) {
      setOutcomeSide(outcomeId === 0 ? 'yes' : 'no');
    }
  }, [outcomeId, initialOutcomeSide]);
  
  // Update order side when prop changes (from tabs)
  useEffect(() => {
    if (initialOrderSide) {
      setOrderSide(initialOrderSide);
    }
  }, [initialOrderSide]);
  
  // Update outcome side when prop changes (from tabs)
  useEffect(() => {
    if (initialOutcomeSide) {
      setOutcomeSide(initialOutcomeSide);
    }
  }, [initialOutcomeSide]);
  
  // Calculate actual side value for contract: buy = 0, sell = 1 (outcome is separate)
  const getContractSide = (): number => {
    // Contract side: 0 = Buy/Long, 1 = Sell/Short
    // Outcome is specified separately via outcomeId
    return orderSide === 'buy' ? 0 : 1;
  };
  
  const [orderType, setOrderType] = useState<'limit' | 'market'>('limit');
  const [price, setPrice] = useState(5000); // 50% in basis points
  const [size, setSize] = useState(100); // In USDC
  const [leverage, setLeverage] = useState(1);
  const [slippageBps, setSlippageBps] = useState(500); // 5% slippage for market orders (default)
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [userUsdcBalance, setUserUsdcBalance] = useState<number | null>(null);
  const [userYesBalance, setUserYesBalance] = useState<number | null>(null);
  const [userNoBalance, setUserNoBalance] = useState<number | null>(null);
  const [checkingBalance, setCheckingBalance] = useState(false);

  const selectedOutcome = market.outcomes[outcomeId];
  const [currentPrice, setCurrentPrice] = useState(5000); // Will be fetched from order book

  // Use WebSocket for real-time price updates instead of polling
  const { price: wsPrice } = useMarketPriceWebSocket(market.id, outcomeId);
  // Get orderbook for best ask/bid prices (needed for accurate market order margin calculation)
  const { orderBook } = useOrderBookWebSocket(market.id, outcomeId, 5);
  
  useEffect(() => {
    if (wsPrice !== null && wsPrice !== undefined) {
      setCurrentPrice(wsPrice);
      // Update price input if it's a market order
      if (orderType === 'market') {
        setPrice(wsPrice);
      }
    } else if (selectedOutcome?.share_price) {
      // Fallback to outcome share_price if available
      setCurrentPrice(selectedOutcome.share_price);
    }
  }, [wsPrice, orderType, selectedOutcome]);

  // Check USDC and token balances (YES/NO)
  useEffect(() => {
    if (!connected || !publicKey) {
      setUserUsdcBalance(null);
      setUserYesBalance(null);
      setUserNoBalance(null);
      return;
    }

    const checkBalance = async () => {
      if (!publicKey) {
        setUserUsdcBalance(null);
        setUserYesBalance(null);
        setUserNoBalance(null);
        return;
      }
      setCheckingBalance(true);
      try {
        // Check USDC balance
        try {
          const userUsdcATA = await getAssociatedTokenAddress(USDC_MINT, publicKey);
          const userUsdcAccount = await getAccount(connection, userUsdcATA);
          setUserUsdcBalance(Number(userUsdcAccount.amount));
        } catch (e) {
          setUserUsdcBalance(0);
        }

        // Check YES token balance for current outcome
        try {
          const [yesMintPDA] = getYesMintPDA(new PublicKey(market.id), outcomeId);
          const userYesATA = await getAssociatedTokenAddress(yesMintPDA, publicKey);
          const userYesAccount = await getAccount(connection, userYesATA);
          setUserYesBalance(Number(userYesAccount.amount));
        } catch (e) {
          setUserYesBalance(0);
        }

        // Check NO token balance
        try {
          const { getNoMintPDA } = await import('@/utils/solana');
          const [noMintPDA] = getNoMintPDA(new PublicKey(market.id), outcomeId);
          const userNoATA = await getAssociatedTokenAddress(noMintPDA, publicKey);
          const userNoAccount = await getAccount(connection, userNoATA);
          setUserNoBalance(Number(userNoAccount.amount));
        } catch (e) {
          setUserNoBalance(0);
        }
      } catch (err) {
        console.error('Error checking balance:', err);
      } finally {
        setCheckingBalance(false);
      }
    };

    checkBalance();
    // Reduced polling frequency - balance doesn't change that often
    // Consider using WebSocket for balance updates in the future
    const interval = setInterval(checkBalance, 30000); // 30 seconds instead of 5
    return () => clearInterval(interval);
  }, [connected, publicKey, connection, market.id, outcomeId]);

  const handlePlaceOrder = async () => {
    if (!connected || !publicKey) {
      setError('Please connect your wallet');
      return;
    }

    if (!isReady) {
      setError('Program not ready. Please wait...');
      return;
    }

    // Block orders when no liquidity on the opposite side
    const hasBids = orderBook?.bids && orderBook.bids.length > 0;
    const hasAsks = orderBook?.asks && orderBook.asks.length > 0;
    if (orderSide === 'buy' && !hasAsks) {
      setError('No sell orders in the order book. Cannot place buy order.');
      return;
    }
    if (orderSide === 'sell' && !hasBids) {
      setError('No buy orders in the order book. Cannot place sell order.');
      return;
    }

    setLoading(true);
    setError(null);
    setSuccess(null);

    try {
      // Convert size from USDC to lamports
      const sizeInLamports = usdcToLamports(size);
      
      // Get contract side value
      const sideValue = getContractSide();
      
      // Calculate trade price (for display and quantity estimation only)
      // Slippage is handled in useSpaceProgram.ts - NOT added to margin here
      let tradePrice: number;
      if (orderType === 'limit') {
        tradePrice = price;
      } else {
        // For market orders, use best ask price (actual expected execution price)
        // Slippage is a tolerance for price movement, NOT an additional charge
        if (orderBook?.asks && orderBook.asks.length > 0) {
          tradePrice = orderBook.asks[0].price;
        } else {
          tradePrice = currentPrice;
        }
      }
      
      // Calculate notional value (total position value)
      // For buy orders: notional = margin * leverage
      // For sell orders: notional = shares * price (quantity is already in shares)
      let notionalInLamports: number;
      let quantity: number;
      
      if (orderSide === 'sell') {
        // For sell orders, size represents the number of shares to sell
        // Quantity = size (already in lamports, represents shares)
        quantity = sizeInLamports;
        // Notional = quantity * price (for display purposes)
        notionalInLamports = (quantity * tradePrice) / 10000;
        
        // Check token balance
        const tokenBalance = outcomeId === 0 ? userYesBalance : userNoBalance;
        const tokenName = outcomeId === 0 ? 'YES' : 'NO';
        
        if (tokenBalance === null || tokenBalance < quantity) {
          throw new Error(
            `Insufficient ${tokenName} shares to sell. Required: ${(quantity / 1e6).toFixed(6)} shares. ` +
            `Your balance: ${tokenBalance !== null ? (tokenBalance / 1e6).toFixed(6) : '0'} shares. ` +
            `You can buy shares from the market or mint them.`
          );
        }
        // For sell orders, we only need shares - no USDC/margin required
        // Skip the USDC balance check below
      } else {
        // For buy orders: 
        // - size = margin amount in USDC
        // - notional = margin * leverage
        // - quantity = (notional * 10000) / price (shares we want to buy)
        notionalInLamports = sizeInLamports * leverage;
        quantity = Math.floor((notionalInLamports * 10000) / tradePrice);
        
        // Calculate required margin (should equal size, but verify with actual price)
        const requiredMargin = notionalInLamports / leverage;
        // On-chain enforces 20% initial margin floor for leverage > 5x
        const minMarginFloor = notionalInLamports * 0.20;
        const effectiveMargin = Math.max(requiredMargin, minMarginFloor);
        // Market orders need extra for fees (1% of notional)
        const feeAmount = orderType === 'market' ? notionalInLamports * 0.01 : 0;
        const requiredBalance = effectiveMargin + feeAmount;

        if (userUsdcBalance === null || userUsdcBalance < requiredBalance) {
          throw new Error(
            `Insufficient USDC balance. Required: ${(requiredBalance / 1e6).toFixed(2)} USDC` +
            (leverage > 5 ? ` (20% margin floor applies at ${leverage}x)` : '') +
            `. Your balance: ${userUsdcBalance ? (userUsdcBalance / 1e6).toFixed(2) : '0'} USDC. ` +
            (orderType === 'market' ? `(Market order margin calculated at worst-case price: ${(tradePrice / 100).toFixed(2)}¢)` : '')
          );
        }
      }
      
      // Generate unique order ID (timestamp in seconds + random component for uniqueness)
      // This orderId is used for on-chain PDA derivation, so it must be unique per user
      const orderId = Math.floor(Date.now() / 1000) + Math.floor(Math.random() * 1000);
      
      if (orderType === 'limit') {
        let result;
        try {
          result = await placeLimitOrder({
            market: market.id,
            outcomeId,
            side: sideValue,
            price: price,
            quantity: quantity,
            leverage,
            orderId,
          });
        } catch (orderError: any) {
          // Check if it's a user rejection - handle immediately to prevent Next.js error popup
          if (orderError?.isUserRejection || 
              orderError?.name === 'UserRejectionError' ||
              (orderError?.message || '').toLowerCase().includes('rejected by user') ||
              orderError?.code === 4001) {
            setError('Transaction was cancelled. No charges were made.');
            setLoading(false);
            setTimeout(() => setError(null), 3000);
            return; // Exit early - don't let error propagate
          }
          // Re-throw if it's not a user rejection
          throw orderError;
        }
        
        console.log('Limit order placed on-chain:', result.pendingOrder);
        
        // Store in database for order book display
        try {
          await axios.post(
            `${API_URL}/api/v1/orders/limit`,
            {
              market_id: market.id,
              outcome_id: outcomeId,
              side: orderSide, // Send 'buy' or 'sell', not 'yes' or 'no'
              size: quantity,
              leverage,
              price: price,
              on_chain_order: result.pendingOrder,
              order_id: orderId,
            },
            {
              headers: {
                'X-Pubkey': publicKey.toString(),
              },
            }
          );
        } catch (backendError) {
          console.warn('Failed to store order in database:', backendError);
        }
        
        // Refresh balance
        try {
          const userUsdcATA = await getAssociatedTokenAddress(USDC_MINT, publicKey!);
          const userUsdcAccount = await getAccount(connection, userUsdcATA);
          setUserUsdcBalance(Number(userUsdcAccount.amount));
        } catch (e) {
          console.warn('Could not refresh balance:', e);
        }
        
        setSuccess(`Limit order placed! Order ID: ${orderId}`);
        
        // Trigger order matching
        try {
          await axios.post(
            `${API_URL}/api/v1/orderbook/${market.id}/${outcomeId}/match`
          );
        } catch (matchError) {
          console.warn('Failed to trigger order matching:', matchError);
        }
      } else {
        // Market order - accepts USDC amount, calculates quantity based on market price
        // Use 5% slippage by default (500 bps) if not specified
        const marketSlippageBps = slippageBps || 500;
        
        let result;
        try {
          if (orderSide === 'buy') {
            // For buy orders, pass USDC amount - quantity will be calculated based on market price
            result = await placeMarketOrder({
              market: market.id,
              outcomeId,
              side: sideValue,
              usdcAmount: sizeInLamports, // Pass USDC amount, not quantity
              maxSlippageBps: marketSlippageBps,
              leverage,
              orderId,
            });
          } else {
            // For sell orders, pass quantity (shares) - quantity is already calculated above
            result = await placeMarketOrder({
              market: market.id,
              outcomeId,
              side: sideValue,
              usdcAmount: 0, // Not used for sell orders
              quantity: quantity, // Shares to sell
              maxSlippageBps: marketSlippageBps,
              leverage,
              orderId,
            });
          }
        } catch (orderError: any) {
          // Check if it's a user rejection - handle immediately to prevent Next.js error popup
          if (orderError?.isUserRejection || 
              orderError?.name === 'UserRejectionError' ||
              (orderError?.message || '').toLowerCase().includes('rejected by user') ||
              orderError?.code === 4001) {
            setError('Transaction was cancelled. No charges were made.');
            setLoading(false);
            setTimeout(() => setError(null), 3000);
            return; // Exit early - don't let error propagate
          }
          // Re-throw if it's not a user rejection
          throw orderError;
        }
        
        console.log('Market order placed on-chain:', result.pendingOrder);
        
        // IMPORTANT: Store market order in database with actual expected fill price (not slippage-inflated)
        const executionPrice = ('bestAskPrice' in result ? (result as any).bestAskPrice : null) || result.aggressivePrice || (sideValue === 0 ? 9900 : 100);
        // For buy orders, quantity is calculated in placeBuyMarketOrder
        // For sell orders, quantity is already known
        const calculatedQuantity = 'calculatedQuantity' in result ? result.calculatedQuantity : quantity;
        
        try {
          await axios.post(
            `${API_URL}/api/v1/orders/market`,
            {
              market_id: market.id,
              outcome_id: outcomeId,
              side: orderSide, // 'buy' or 'sell'
              size: orderSide === 'buy' ? sizeInLamports : calculatedQuantity, // USDC for buy, shares for sell
              leverage,
              price: executionPrice, // Execution price used
              on_chain_order: result.pendingOrder,
              order_id: orderId,
            },
            {
              headers: {
                'X-Pubkey': publicKey.toString(),
              },
            }
          );
          console.log('[TradingPanel] Market order stored in database:', {
            price: executionPrice,
            quantity: calculatedQuantity,
            onChainOrder: result.pendingOrder,
            orderId,
          });
        } catch (backendError) {
          console.warn('Failed to store market order in database:', backendError);
        }
        
        setSuccess(`Market order placed at ${Math.round(executionPrice / 100)}¢! Order ID: ${orderId}. Executing...`);
        
        // Trigger immediate matching for market orders
        try {
          console.log('[TradingPanel] Triggering order matching');
          const matchResponse = await axios.post(
            `${API_URL}/api/v1/orderbook/${market.id}/${outcomeId}/match`,
            {},
            { timeout: 30000 }
          );
          console.log('[TradingPanel] Matching triggered:', matchResponse.data);
          
          // Wait a bit for the transaction to complete
          await new Promise(resolve => setTimeout(resolve, 3000));
          
          // Refresh balance after matching
          try {
            const userUsdcATA = await getAssociatedTokenAddress(USDC_MINT, publicKey!);
            const userUsdcAccount = await getAccount(connection, userUsdcATA);
            setUserUsdcBalance(Number(userUsdcAccount.amount));
            
            // Also check for YES token balance
            try {
              const { getYesMintPDA } = await import('@/utils/solana');
              const [yesMintPDA] = getYesMintPDA(new PublicKey(market.id), outcomeId);
              const userYesATA = await getAssociatedTokenAddress(yesMintPDA, publicKey!);
              const userYesAccount = await getAccount(connection, userYesATA);
              console.log('[TradingPanel] User YES token balance:', Number(userYesAccount.amount));
            } catch (tokenError) {
              console.warn('Could not check YES token balance:', tokenError);
            }
          } catch (e) {
            console.warn('Could not refresh balance:', e);
          }
          
          setSuccess(`Market order executed! Check your wallet for YES tokens. Order ID: ${orderId}`);
        } catch (matchError: any) {
          console.error('Failed to trigger order matching:', matchError);
          setError(
            `Order placed but matching failed. Your USDC is locked in escrow. ` +
            `Order ID: ${orderId}. The keeper will match it automatically. ` +
            `Error: ${matchError.message}`
          );
        }
      }
      
      // Reset form
      setSize(100);
      setLeverage(1);
      setPrice(orderType === 'limit' ? price : currentPrice);
    } catch (err: any) {
      // Check if it's a user rejection error - handle silently
      const isRejection = 
        err.isUserRejection ||
        err.name === 'UserRejectionError' ||
        (err.message || '').toLowerCase().includes('rejected by user') ||
        (err.message || '').toLowerCase().includes('walletsigntransactionerror') ||
        err.code === 4001;
      
      if (isRejection) {
        // User rejection - handle silently, no error logging
        setError('Transaction was cancelled. No charges were made.');
        // Clear error state after a moment
        setTimeout(() => setError(null), 3000);
        return; // Exit early, prevent error propagation
      }
      
      // Real error - log and display
      console.error('[TradingPanel] Trade error:', err);
      setError(err.message || 'Failed to execute trade');
    } finally {
      setLoading(false);
    }
  };

  // Calculate position summary
  const positionSize = size * leverage;
  const quantity = usdcToLamports(positionSize);
  const tradePrice = orderType === 'limit' ? price : currentPrice;
  const notional = (quantity * tradePrice) / 10000;
  const marginRequired = notional / leverage;
  const shares = quantity;

  // On-chain enforces a 20% initial margin floor (INITIAL_MARGIN_BPS = 2000)
  // For leverage > 5x, actual deduction = notional * 20% (higher than notional / leverage)
  const INITIAL_MARGIN_RATE = 0.20;
  const minMarginOnChain = notional * INITIAL_MARGIN_RATE;
  const actualMarginDeducted = Math.max(marginRequired, minMarginOnChain);
  const hasMarginFloor = leverage > 5 && orderSide === 'buy' && actualMarginDeducted > marginRequired;

  return (
    <div className="bg-space-gray-800 rounded-xl border border-space-gray-700 p-6">
      <div className="mb-4">
        <p className="text-sm text-space-gray-400 mb-1">Selected Outcome</p>
        <div className="flex items-center space-x-2">
          <div className="w-8 h-8 rounded-full bg-space-gray-700"></div>
          <p className="text-sm font-semibold text-white">{selectedOutcome?.label || 'Outcome'}</p>
        </div>
      </div>

      {/* Balance Display */}
      {connected && (
        <div className="mb-4 p-4 bg-space-gray-700 rounded-lg space-y-2">
          <div className="flex justify-between items-center text-sm">
            <span className="text-space-gray-400">Wallet USDC:</span>
            <span className="text-white font-semibold">
              {checkingBalance ? '...' : userUsdcBalance !== null ? `$${(userUsdcBalance / 1e6).toFixed(2)}` : '$0.00'}
            </span>
          </div>
          {orderSide === 'sell' && (
            <>
              <div className="flex justify-between items-center text-sm border-t border-space-gray-600 pt-2">
                <span className="text-space-gray-400">YES Shares:</span>
                <span className={`font-semibold ${(userYesBalance || 0) >= (usdcToLamports(size) * leverage) ? 'text-green-400' : 'text-red-400'}`}>
                  {checkingBalance ? '...' : userYesBalance !== null ? `${(userYesBalance / 1e6).toFixed(6)}` : '0'}
                </span>
              </div>
              <div className="flex justify-between items-center text-sm">
                <span className="text-space-gray-400">NO Shares:</span>
                <span className={`font-semibold ${(userNoBalance || 0) >= (usdcToLamports(size) * leverage) ? 'text-green-400' : 'text-red-400'}`}>
                  {checkingBalance ? '...' : userNoBalance !== null ? `${(userNoBalance / 1e6).toFixed(6)}` : '0'}
                </span>
              </div>
            </>
          )}
        </div>
      )}

      {/* Error/Success Messages */}
      {error && (
        <div className="mb-4 p-3 bg-red-500/10 border border-red-500/30 rounded-lg text-red-400 text-sm">
          {error}
        </div>
      )}
      {success && (
        <div className="mb-4 p-3 bg-green-500/10 border border-green-500/30 rounded-lg text-green-400 text-sm">
          {success}
        </div>
      )}

      {/* Order Side Selection: Buy/Sell */}
      {!hideSideSelection && (
        <div className="mb-6">
          <div className="flex items-center space-x-2 mb-3">
            <button
              onClick={() => setOrderSide('buy')}
              className={`flex-1 px-4 py-3 rounded-lg font-semibold transition-colors ${
                orderSide === 'buy'
                  ? 'bg-space-success text-white'
                  : 'bg-space-gray-700 text-space-gray-300 hover:bg-space-gray-600'
              }`}
            >
              Buy
            </button>
            <button
              onClick={() => setOrderSide('sell')}
              className={`flex-1 px-4 py-3 rounded-lg font-semibold transition-colors ${
                orderSide === 'sell'
                  ? 'bg-space-danger text-white'
                  : 'bg-space-gray-700 text-space-gray-300 hover:bg-space-gray-600'
              }`}
            >
              Sell
            </button>
          </div>
          {/* Outcome Selection: YES/NO */}
          <div className="flex items-center space-x-2">
            <button
              onClick={() => setOutcomeSide('yes')}
              className={`flex-1 px-4 py-3 rounded-lg font-semibold transition-colors ${
                outcomeSide === 'yes'
                  ? 'bg-space-success/20 text-space-success border-2 border-space-success'
                  : 'bg-space-gray-700 text-space-gray-300 hover:bg-space-gray-600'
              }`}
            >
              YES {outcomeSide === 'yes' ? (orderSide === 'buy' ? '5¢' : '5¢') : ''}
            </button>
            <button
              onClick={() => setOutcomeSide('no')}
              className={`flex-1 px-4 py-3 rounded-lg font-semibold transition-colors ${
                outcomeSide === 'no'
                  ? 'bg-space-danger/20 text-space-danger border-2 border-space-danger'
                  : 'bg-space-gray-700 text-space-gray-300 hover:bg-space-gray-600'
              }`}
            >
              NO {outcomeSide === 'no' ? (orderSide === 'buy' ? '96¢' : '96¢') : ''}
            </button>
          </div>
        </div>
      )}

      {/* Order Type: Limit/Market */}
      <div className="flex items-center space-x-2 mb-6">
        <button
          onClick={() => setOrderType('limit')}
          className={`flex-1 px-4 py-3 rounded-lg font-semibold transition-colors ${
            orderType === 'limit'
              ? 'bg-space-primary text-white'
              : 'bg-space-gray-700 text-space-gray-300 hover:bg-space-gray-600'
          }`}
        >
          Limit
        </button>
        <button
          onClick={() => setOrderType('market')}
          className={`flex-1 px-4 py-3 rounded-lg font-semibold transition-colors ${
            orderType === 'market'
              ? 'bg-space-primary text-white'
              : 'bg-space-gray-700 text-space-gray-300 hover:bg-space-gray-600'
          }`}
        >
          Market
        </button>
      </div>

      {/* Market Order Info & Slippage */}
      {orderType === 'market' && (
        <div className="mb-4 space-y-3">
          <div className="p-3 bg-blue-900/30 border border-blue-600/50 rounded-lg">
            <div className="flex items-start gap-2">
              <span className="text-blue-400 text-lg">ℹ️</span>
              <div className="text-sm">
                <p className="text-blue-300 font-semibold">Instant Execution</p>
                <p className="text-blue-200/80 mt-1">
                  Executes immediately at best available price or fails if no liquidity.
                  You pay exactly what you see - no excess funds locked.
                </p>
              </div>
            </div>
          </div>
          
          {/* Slippage Setting */}
          <div className="p-3 bg-space-gray-700/50 rounded-lg">
            <label className="block text-sm font-medium text-space-gray-300 mb-2">
              Max Slippage Tolerance
            </label>
            <div className="flex items-center gap-2">
              {[1, 2, 5, 10].map((pct) => (
                <button
                  key={pct}
                  onClick={() => setSlippageBps(pct * 100)}
                  className={`px-3 py-1.5 text-sm rounded-lg transition-colors ${
                    slippageBps === pct * 100
                      ? 'bg-space-primary text-white'
                      : 'bg-space-gray-600 text-space-gray-300 hover:bg-space-gray-500'
                  }`}
                >
                  {pct}%
                </button>
              ))}
            </div>
            <p className="mt-2 text-xs text-space-gray-400">
              Order will fail if best price differs from current by more than {slippageBps / 100}%
            </p>
          </div>
        </div>
      )}

      {/* Current Price Display */}
      <div className="mb-6 p-4 bg-space-gray-700/50 rounded-lg">
        <div className="flex justify-between items-center mb-2">
          <span className="text-sm text-space-gray-400">Current Price</span>
          <span className="text-lg font-bold text-white">{formatPrice(currentPrice)}</span>
        </div>
        <div className="flex justify-between text-xs text-space-gray-500">
          <span>YES: {(currentPrice / 100).toFixed(2)}¢</span>
          <span>NO: {((10000 - currentPrice) / 100).toFixed(2)}¢</span>
        </div>
      </div>

      {/* Price Input (Limit Orders Only) */}
      {orderType === 'limit' && (
        <div className="mb-6">
          <label className="block text-sm font-medium text-space-gray-300 mb-2">
            Price per Share (Cents)
          </label>
          <div className="flex items-center space-x-2">
            <input
              type="text"
              inputMode="decimal"
              value={(price / 100).toFixed(2)}
              onChange={(e) => {
                const val = e.target.value.replace(/[^0-9.]/g, '');
                const cents = parseFloat(val) || 0;
                setPrice(Math.max(1, Math.min(10000, Math.round(cents * 100))));
              }}
              className="flex-1 px-4 py-2 bg-space-gray-700 border border-space-gray-600 rounded-lg text-white focus:outline-none focus:ring-2 focus:ring-space-primary"
              placeholder="0.00"
            />
            <span className="text-space-gray-400 font-semibold">¢</span>
          </div>
          <p className="mt-1 text-xs text-space-gray-400">
            {formatPrice(price)} - Current Market: {formatPrice(currentPrice)}
          </p>
        </div>
      )}

      {/* Shares/Cents Input */}
      <div className="mb-6">
        <label className="block text-sm font-medium text-space-gray-300 mb-2">
          {orderSide === 'buy' ? 'How many shares do you want to buy?' : 'How many shares do you want to sell?'}
          <span className="ml-2 text-xs text-space-gray-400">
            {orderSide === 'buy' ? `($${(quantity * tradePrice / 10000 / 1e6).toFixed(2)} @ ${Math.round(tradePrice / 100)}¢ per share)` : `(Will receive ~$${((quantity * tradePrice) / 10000 / 1e6).toFixed(2)} @ ${Math.round(tradePrice / 100)}¢ per share)`}
          </span>
        </label>
        <div className="space-y-3">
          <div className="flex items-center space-x-2">
            <input
              type="text"
              inputMode="decimal"
              value={quantity > 0 ? (quantity / 1e6).toString() : ''}
              onChange={(e) => {
                const val = e.target.value.replace(/[^0-9.]/g, '');
                const shares = parseFloat(val) || 0;
                // Calculate size from shares: quantity = size * leverage * 1e6
                // So: size = shares / leverage
                const calculatedSize = shares / leverage;
                setSize(Math.max(0, calculatedSize));
              }}
              className="flex-1 px-4 py-3 bg-space-gray-700 border border-space-gray-600 rounded-lg text-white text-lg font-semibold focus:outline-none focus:ring-2 focus:ring-space-primary"
              placeholder="0"
            />
            <span className="text-space-gray-400 font-semibold">shares</span>
          </div>
          <div className="flex items-center space-x-2">
            <input
              type="text"
              inputMode="decimal"
              value={orderType === 'limit' ? (price / 100).toFixed(2) : (currentPrice / 100).toFixed(2)}
              onChange={(e) => {
                if (orderType === 'limit') {
                  const val = e.target.value.replace(/[^0-9.]/g, '');
                  const cents = parseFloat(val) || 0;
                  setPrice(Math.max(1, Math.min(10000, Math.round(cents * 100))));
                }
              }}
              disabled={orderType === 'market'}
              className="flex-1 px-4 py-3 bg-space-gray-700 border border-space-gray-600 rounded-lg text-white text-lg font-semibold focus:outline-none focus:ring-2 focus:ring-space-primary disabled:opacity-50 disabled:cursor-not-allowed"
              placeholder="0.00"
            />
            <span className="text-space-gray-400 font-semibold">¢ per share</span>
          </div>
          <div className="text-xs text-space-gray-400 pt-2 border-t border-space-gray-600">
            {orderSide === 'sell' ? (
              <>
                <div className="flex justify-between">
                  <span>Shares Required:</span>
                  <span className="text-white">{(shares / 1e6).toFixed(6)}</span>
                </div>
                <div className="flex justify-between mt-1">
                  <span>Position Size:</span>
                  <span className="text-white">{(shares / 1e6).toFixed(6)} shares @ {leverage}x</span>
                </div>
              </>
            ) : (
              <>
                <div className="flex justify-between">
                  <span>Margin Amount (USDC):</span>
                  <span className="text-white">${(marginRequired / 1e6).toFixed(2)}</span>
                </div>
                <div className="flex justify-between mt-1">
                  <span>Position Size:</span>
                  <span className="text-white">${positionSize.toFixed(2)} @ {leverage}x</span>
                </div>
              </>
            )}
          </div>
        </div>
        <div className="flex items-center space-x-2">
          {[1, 20, 100, 500].map((val) => (
            <button
              key={val}
              onClick={() => setSize(val)}
              className="px-3 py-1.5 bg-space-gray-700 hover:bg-space-gray-600 text-space-gray-300 text-sm font-medium rounded-lg transition-colors"
            >
              ${val}
            </button>
          ))}
        </div>
      </div>

      {/* Leverage Slider */}
      <div className="mb-6">
        <label className="block text-sm font-medium text-space-gray-300 mb-2">
          Leverage: {leverage}x
        </label>
        <input
          type="range"
          min={1}
          max={10}
          value={leverage}
          onChange={(e) => setLeverage(Number(e.target.value))}
          className="w-full"
        />
        <div className="flex justify-between text-xs text-space-gray-500 mt-1">
          <span>1x</span>
          <span>10x</span>
        </div>
        {leverage > 1 && (
          <p className="mt-2 text-xs text-yellow-500">
            ⚠️ {leverage}x leverage increases risk of liquidation
          </p>
        )}
      </div>

      {/* Order Summary */}
      <div className="mb-6 p-4 bg-space-gray-700/50 rounded-lg space-y-2 text-sm">
        {orderSide === 'sell' ? (
          <>
            <div className="flex justify-between text-space-gray-400">
              <span>Shares to Sell</span>
              <span className="text-white font-semibold">{(shares / 1e6).toFixed(6)}</span>
            </div>
            <div className="flex justify-between text-space-gray-400">
              <span>Leverage</span>
              <span className="text-white font-semibold">{leverage}x</span>
            </div>
          </>
        ) : (
          <>
            <div className="flex justify-between text-space-gray-400">
              <span>Position Size</span>
              <span className="text-white font-semibold">${positionSize.toFixed(2)}</span>
            </div>
            <div className="flex justify-between text-space-gray-400">
              <span>Margin Required</span>
              <span className={`font-semibold ${hasMarginFloor ? 'text-orange-400' : 'text-white'}`}>
                ${hasMarginFloor ? (actualMarginDeducted / 1e6).toFixed(2) : (marginRequired / 1e6).toFixed(2)}
              </span>
            </div>
            {hasMarginFloor && (
              <div className="p-2 bg-orange-500/10 border border-orange-500/20 rounded-lg">
                <p className="text-xs text-orange-400">
                  On-chain 20% initial margin floor applies at {leverage}x leverage.
                  Effective leverage: 5x. Wallet will be charged ${(actualMarginDeducted / 1e6).toFixed(2)} instead of ${(marginRequired / 1e6).toFixed(2)}.
                </p>
              </div>
            )}
          </>
        )}
        <div className="flex justify-between text-space-gray-400">
          <span>Entry Price</span>
          <span className="text-white font-semibold">{formatPrice(tradePrice)}</span>
        </div>
        <div className="flex justify-between text-space-gray-400">
          <span>Shares</span>
          <span className="text-white font-semibold">{(shares / 1e6).toFixed(2)}</span>
        </div>
        {orderSide === 'buy' && outcomeSide === 'yes' && (
          <div className="pt-2 border-t border-space-gray-600">
            <div className="flex justify-between text-space-gray-400">
              <span>Potential Profit (if YES wins)</span>
              <span className="text-space-success font-bold">
                ${((positionSize * (100 - tradePrice / 100)) / (tradePrice / 100)).toFixed(2)}
              </span>
            </div>
          </div>
        )}
      </div>

      {/* Place Order Button */}
      <button
        onClick={handlePlaceOrder}
        disabled={loading || !connected || programLoading}
        className={`w-full py-4 rounded-lg font-bold text-lg transition-colors mb-4 ${
          orderSide === 'buy'
            ? 'bg-space-success hover:bg-space-success/90 text-white'
            : 'bg-space-danger hover:bg-space-danger/90 text-white'
        } ${!connected || loading || programLoading ? 'opacity-50 cursor-not-allowed' : ''}`}
      >
        {loading ? 'Placing Order...' : connected ? `${orderSide === 'buy' ? 'Buy' : 'Sell'} ${outcomeSide.toUpperCase()} ${orderType === 'limit' ? 'Limit' : 'Market'} Order` : 'Connect Wallet'}
      </button>

      {!connected && (
        <p className="text-center text-space-gray-400 text-sm">
          Connect your wallet to place orders
        </p>
      )}
    </div>
  );
}
