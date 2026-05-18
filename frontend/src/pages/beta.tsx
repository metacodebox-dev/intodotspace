import { useState, useEffect, useCallback, useRef } from 'react';
import { useRouter } from 'next/router';
import { useWallet } from '@solana/wallet-adapter-react';
import { useWalletModal } from '@solana/wallet-adapter-react-ui';
import Head from 'next/head';
import bs58 from 'bs58';
import {
  verifyBetaCode,
  redeemBetaCode,
  checkBetaStatus,
  storeAccessToken,
  isBetaGateEnabled,
  VerifyResponse,
  getStoredAccessToken,
} from '@/lib/betaGate';
import Image from 'next/image';
import { wsManager } from '@/hooks/websocketManager';

type Step = 'input' | 'verifying' | 'signing' | 'success' | 'error';

interface ErrorState {
  code: string;
  message: string;
}

export default function BetaAccessPage() {
  const router = useRouter();
  const { redirect, error: urlError } = router.query;
  
  const { connected, publicKey, signMessage } = useWallet();
  const { setVisible } = useWalletModal();

  // State
  const [step, setStep] = useState<Step>('input');
  const [betaCode, setBetaCode] = useState('');
  const [challenge, setChallenge] = useState<VerifyResponse['challenge'] | null>(null);
  const [error, setError] = useState<ErrorState | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [checkingStatus, setCheckingStatus] = useState(true);
  const hasCheckedRef = useRef(false);
  const hasRedirectedRef = useRef(false);
  const [isBetaUser, setIsBetaUser] = useState(false);
  // Initialize WebSocket connection (even on beta page)
  useEffect(() => {
    wsManager.connect();
  }, []);

  // Check if user already has access (only once on mount)
  useEffect(() => {
    // Prevent multiple checks
    if (hasCheckedRef.current) {
      return;
    }
    hasCheckedRef.current = true;

    let isMounted = true;
    
    const checkAccess = async () => {
      // Prevent multiple redirects
      if (hasRedirectedRef.current) {
        return;
      }

      // If gate is disabled, redirect immediately
      if (!isBetaGateEnabled()) {
        const target = (redirect as string) || '/';
        hasRedirectedRef.current = true;
        window.location.href = target;
        return;
      }

      try {
        const status = await checkBetaStatus();
        const token = getStoredAccessToken();
        if (token) {
          setIsBetaUser(true);
          setCheckingStatus(false);
          return;
        }
        if (!isMounted || hasRedirectedRef.current) return;
        
        if (status.gateDisabled || status.wallet) {
          // const target = (redirect as string) || '/';
          // hasRedirectedRef.current = true;
          // Use window.location for immediate redirect (causes full page navigation)
          // window.location.href = target;
          setCheckingStatus(false);
          return;
        }

        setCheckingStatus(false);
      } catch (error) {
        if (isMounted && !hasRedirectedRef.current) {
          setCheckingStatus(false);
        }
      }
    };

    checkAccess();
    
    return () => {
      isMounted = false;
    };
  }, []); // Run only once on mount

  // Handle URL error parameter
  useEffect(() => {
    if (urlError === 'expired') {
      setError({
        code: 'SESSION_EXPIRED',
        message: 'Your beta access has expired. Please enter your code again.',
      });
    }
  }, [urlError]);

  // Open wallet modal
  const handleConnectWallet = () => {
    setVisible(true);
  };

  // Verify code and sign
  const handleUnlockAccess = async () => {
    if (!betaCode.trim()) {
      setError({ code: 'EMPTY_CODE', message: 'Please enter a beta code' });
      return;
    }

    if (!connected || !publicKey || !signMessage) {
      setError({ code: 'NO_WALLET', message: 'Please connect your wallet first' });
      return;
    }

    setIsLoading(true);
    setError(null);
    setStep('verifying');

    // Step 1: Verify the code
    const verifyResult = await verifyBetaCode(betaCode);

    if (verifyResult.gateDisabled) {
      const target = (redirect as string) || '/';
      router.replace(target);
      return;
    }

    if (!verifyResult.valid) {
      setError({
        code: verifyResult.error || 'INVALID_CODE',
        message: verifyResult.message || 'Invalid beta code',
      });
      setStep('input');
      setIsLoading(false);
      return;
    }

    // Step 2: Sign the challenge
    setStep('signing');
    const challengeData = verifyResult.challenge!;
    setChallenge(challengeData);

    try {
      const messageBytes = new TextEncoder().encode(challengeData.message);
      const signatureBytes = await signMessage(messageBytes);
      const signature = bs58.encode(signatureBytes);

      // Step 3: Redeem the code
      const redeemResult = await redeemBetaCode(
        challengeData.nonce,
        signature,
        publicKey.toBase58()
      );

      if (redeemResult.gateDisabled) {
        const target = (redirect as string) || '/';
        router.replace(target);
        return;
      }

      if (!redeemResult.success) {
        setError({
          code: redeemResult.error || 'REDEEM_FAILED',
          message: redeemResult.message || 'Failed to redeem code',
        });
        setStep('error');
        setIsLoading(false);
        return;
      }

      // Store token
      if (redeemResult.accessToken) {
        storeAccessToken(redeemResult.accessToken);
      }

      // Success!
      setStep('success');
      setIsLoading(false);

      // Redirect after brief delay to ensure cookie is set
      // Use window.location.href for full page reload so middleware can read cookie
      setTimeout(() => {
        const target = (redirect as string) || '/';
        window.location.href = target;
      }, 1500);
    } catch (err: any) {
      console.error('[Beta] Sign error:', err);
      
      if (err.message?.includes('User rejected')) {
        setError({
          code: 'SIGNATURE_REJECTED',
          message: 'You rejected the signature request. Please try again.',
        });
      } else {
        setError({
          code: 'SIGN_ERROR',
          message: 'Failed to sign message. Please try again.',
        });
      }
      setStep('input');
      setIsLoading(false);
    }
  };

  // Reset flow
  const handleReset = () => {
    setBetaCode('');
    setChallenge(null);
    setError(null);
    setStep('input');
  };

  // Loading state while checking access
  if (checkingStatus) {
    return (
      <div className="min-h-screen bg-[#0a0a0a] flex items-center justify-center">
        <div className="animate-spin rounded-full h-12 w-12 border-4 border-white/20 border-t-white"></div>
      </div>
    );
  }

  return (
    <>
      <Head>
        <title>Beta Access | Space Prediction Market</title>
        <meta name="description" content="Enter your beta code to access Space Prediction Market" />
      </Head>

      <div className="min-h-screen bg-[#0a0a0a] flex flex-col items-center justify-center px-4 overflow-hidden">
        {/* Geometric lines background */}
        <div className="absolute inset-0 overflow-hidden">
          <svg className="absolute inset-0 w-full h-full" xmlns="http://www.w3.org/2000/svg" preserveAspectRatio="none">
            <defs>
              <linearGradient id="lineFadeV" x1="0%" y1="0%" x2="0%" y2="100%">
                <stop offset="0%" stopColor="white" stopOpacity="0.15" />
                <stop offset="40%" stopColor="white" stopOpacity="0.08" />
                <stop offset="70%" stopColor="white" stopOpacity="0.03" />
                <stop offset="100%" stopColor="white" stopOpacity="0" />
              </linearGradient>
              <linearGradient id="lineFadeH" x1="0%" y1="0%" x2="100%" y2="0%">
                <stop offset="0%" stopColor="white" stopOpacity="0" />
                <stop offset="20%" stopColor="white" stopOpacity="0.1" />
                <stop offset="50%" stopColor="white" stopOpacity="0.15" />
                <stop offset="80%" stopColor="white" stopOpacity="0.1" />
                <stop offset="100%" stopColor="white" stopOpacity="0" />
              </linearGradient>
            </defs>
            
            {/* Vertical lines */}
            <line x1="10%" y1="0" x2="10%" y2="100%" stroke="url(#lineFadeV)" strokeWidth="1">
              <animate attributeName="opacity" values="0.8;0.3;0.8" dur="4s" repeatCount="indefinite" />
            </line>
            <line x1="20%" y1="0" x2="20%" y2="100%" stroke="url(#lineFadeV)" strokeWidth="1">
              <animate attributeName="opacity" values="0.6;0.2;0.6" dur="5s" repeatCount="indefinite" />
            </line>
            <line x1="30%" y1="0" x2="30%" y2="100%" stroke="url(#lineFadeV)" strokeWidth="1">
              <animate attributeName="opacity" values="0.7;0.25;0.7" dur="4.5s" repeatCount="indefinite" />
            </line>
            <line x1="40%" y1="0" x2="40%" y2="100%" stroke="url(#lineFadeV)" strokeWidth="1">
              <animate attributeName="opacity" values="0.5;0.15;0.5" dur="6s" repeatCount="indefinite" />
            </line>
            <line x1="50%" y1="0" x2="50%" y2="100%" stroke="url(#lineFadeV)" strokeWidth="1">
              <animate attributeName="opacity" values="0.9;0.35;0.9" dur="3.5s" repeatCount="indefinite" />
            </line>
            <line x1="60%" y1="0" x2="60%" y2="100%" stroke="url(#lineFadeV)" strokeWidth="1">
              <animate attributeName="opacity" values="0.5;0.15;0.5" dur="5.5s" repeatCount="indefinite" />
            </line>
            <line x1="70%" y1="0" x2="70%" y2="100%" stroke="url(#lineFadeV)" strokeWidth="1">
              <animate attributeName="opacity" values="0.7;0.25;0.7" dur="4s" repeatCount="indefinite" />
            </line>
            <line x1="80%" y1="0" x2="80%" y2="100%" stroke="url(#lineFadeV)" strokeWidth="1">
              <animate attributeName="opacity" values="0.6;0.2;0.6" dur="5s" repeatCount="indefinite" />
            </line>
            <line x1="90%" y1="0" x2="90%" y2="100%" stroke="url(#lineFadeV)" strokeWidth="1">
              <animate attributeName="opacity" values="0.8;0.3;0.8" dur="4.5s" repeatCount="indefinite" />
            </line>
            
            {/* Horizontal lines */}
            <line x1="0" y1="8%" x2="100%" y2="8%" stroke="url(#lineFadeH)" strokeWidth="1">
              <animate attributeName="opacity" values="0.7;0.25;0.7" dur="5s" repeatCount="indefinite" />
            </line>
            <line x1="0" y1="16%" x2="100%" y2="16%" stroke="url(#lineFadeH)" strokeWidth="1">
              <animate attributeName="opacity" values="0.5;0.15;0.5" dur="4s" repeatCount="indefinite" />
            </line>
            <line x1="0" y1="24%" x2="100%" y2="24%" stroke="url(#lineFadeH)" strokeWidth="1">
              <animate attributeName="opacity" values="0.6;0.2;0.6" dur="5.5s" repeatCount="indefinite" />
            </line>
            <line x1="0" y1="32%" x2="100%" y2="32%" stroke="url(#lineFadeH)" strokeWidth="1">
              <animate attributeName="opacity" values="0.4;0.1;0.4" dur="4.5s" repeatCount="indefinite" />
            </line>
            <line x1="0" y1="40%" x2="100%" y2="40%" stroke="url(#lineFadeH)" strokeWidth="1">
              <animate attributeName="opacity" values="0.3;0.08;0.3" dur="6s" repeatCount="indefinite" />
            </line>
            <line x1="0" y1="48%" x2="100%" y2="48%" stroke="url(#lineFadeH)" strokeWidth="1">
              <animate attributeName="opacity" values="0.2;0.05;0.2" dur="5s" repeatCount="indefinite" />
            </line>
            
            {/* Diagonal accent lines */}
            <line x1="0" y1="0" x2="30%" y2="50%" stroke="url(#lineFadeV)" strokeWidth="0.5" opacity="0.4">
              <animate attributeName="opacity" values="0.4;0.1;0.4" dur="7s" repeatCount="indefinite" />
            </line>
            <line x1="100%" y1="0" x2="70%" y2="50%" stroke="url(#lineFadeV)" strokeWidth="0.5" opacity="0.4">
              <animate attributeName="opacity" values="0.4;0.1;0.4" dur="6s" repeatCount="indefinite" />
            </line>
            <line x1="20%" y1="0" x2="40%" y2="40%" stroke="url(#lineFadeV)" strokeWidth="0.5" opacity="0.3">
              <animate attributeName="opacity" values="0.3;0.08;0.3" dur="8s" repeatCount="indefinite" />
            </line>
            <line x1="80%" y1="0" x2="60%" y2="40%" stroke="url(#lineFadeV)" strokeWidth="0.5" opacity="0.3">
              <animate attributeName="opacity" values="0.3;0.08;0.3" dur="7s" repeatCount="indefinite" />
            </line>
          </svg>
          
          {/* Bottom fade overlay */}
          <div className="absolute inset-x-0 bottom-0 h-1/2 bg-gradient-to-t from-[#0a0a0a] via-[#0a0a0a]/90 to-transparent pointer-events-none"></div>
        </div>
        
        {/* Content */}
        <div className="relative z-10 w-full max-w-md">
          {/* Logo/Brand */}
          <div className="text-center mb-8 flex flex-col items-center justify-center gap-4">
            <Image src="/assets/space.svg" alt="Space" width={1000} height={1000} className="w-48" />
            <p className="text-[#737373]">The first leveraged prediction market on 
            Solana.</p>
          </div>

          {/* Card */}
          <div className="bg-[#111111] rounded-2xl border border-[#1a1a1a] p-8">
            {/* Header */}
            <div className="text-center mb-8">
              {/* <div className="w-16 h-16 rounded-2xl bg-white/5 border border-[#262626] flex items-center justify-center mx-auto mb-4">
                
              </div> */}
              <h2 className="text-2xl font-semibold text-white">Early Beta Access</h2>
              <p className="text-sm text-[#737373] mt-1">
                {step === 'input' && 'Enter your early beta code and connect wallet'}
                {step === 'verifying' && 'Verifying your code...'}
                {step === 'signing' && 'Please sign the message in your wallet'}
                {step === 'success' && 'Access granted!'}
                {step === 'error' && 'Something went wrong'}
              </p>
            </div>

            {/* Error Display */}
            {error && (
              <div className="bg-red-500/10 border border-red-500/20 rounded-xl p-4 mb-6">
                <p className="text-red-400 text-sm">{error.message}</p>
              </div>
            )}

            {/* Main Input Step */}
            {step === 'input' && (
              <div className="space-y-4">
                {/* Beta Code Input */}
                <div>
                  <label className="block text-sm font-medium text-[#a3a3a3] mb-2">
                    Beta Code
                  </label>
                  <input
                    type="text"
                    value={betaCode}
                    onChange={(e) => setBetaCode(e.target.value.toUpperCase())}
                    placeholder="BETA-XXXX-XXXX"
                    className="w-full px-4 py-4 bg-[#0a0a0a] border border-[#262626] rounded-xl text-white text-center text-lg font-mono tracking-wider placeholder-[#404040] focus:outline-none focus:ring-2 focus:ring-white/20 focus:border-transparent transition-all"
                    autoFocus
                    onKeyDown={(e) => e.key === 'Enter' && connected && handleUnlockAccess()}
                  />
                </div>

                {/* Wallet Status */}
                <div className="bg-[#0a0a0a] rounded-xl p-4 border border-[#1a1a1a]">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <div className={`w-10 h-10 rounded-lg flex items-center justify-center ${
                        connected 
                          ? 'bg-emerald-500/10 border border-emerald-500/20' 
                          : 'bg-[#1a1a1a] border border-[#262626]'
                      }`}>
                        {connected ? (
                          <span className="text-emerald-400">✓</span>
                        ) : (
                          <svg className="w-5 h-5 text-[#525252]" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 10h18M7 15h1m4 0h1m-7 4h12a3 3 0 003-3V8a3 3 0 00-3-3H6a3 3 0 00-3 3v8a3 3 0 003 3z" />
                          </svg>
                        )}
                      </div>
                      <div>
                        <p className={`font-medium ${connected ? 'text-white' : 'text-[#737373]'}`}>
                          {connected ? 'Wallet Connected' : 'No Wallet Connected'}
                        </p>
                        <p className="text-xs text-[#525252]">
                          {connected && publicKey 
                            ? `${publicKey.toBase58().slice(0, 4)}...${publicKey.toBase58().slice(-4)}`
                            : 'Required to unlock access'
                          }
                        </p>
                      </div>
                    </div>
                    {!connected && (
                      <button
                        onClick={handleConnectWallet}
                        className="px-4 py-2 bg-[#1a1a1a] hover:bg-[#262626] text-white text-sm font-medium rounded-lg border border-[#262626] transition-all"
                      >
                        Connect
                      </button>
                    )}
                  </div>
                </div>

                {/* Unlock Button */}
                <button
                  onClick={handleUnlockAccess}
                  disabled={isLoading || !betaCode.trim() || !connected}
                  className="w-full py-4 bg-white hover:bg-neutral-200 text-black font-semibold rounded-xl transition-all disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
                >
                  {isLoading ? (
                    <>
                      <svg className="animate-spin h-5 w-5" fill="none" viewBox="0 0 24 24">
                        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                      </svg>
                      Processing...
                    </>
                  ) : (
                    'Unlock Access'
                  )}
                </button>
              </div>
            )}

            {/* Verifying/Signing Steps */}
            {(step === 'verifying' || step === 'signing') && (
              <div className="text-center py-8">
                <div className="animate-spin rounded-full h-12 w-12 border-4 border-white/20 border-t-white mx-auto mb-4"></div>
                <p className="text-[#737373]">
                  {step === 'verifying' && 'Verifying your beta code...'}
                  {step === 'signing' && 'Please sign the message in your wallet...'}
                </p>
              </div>
            )}

            {/* Step: Success */}
            {step === 'success' && (
              <div className="text-center py-8">
                <div className="w-16 h-16 rounded-full bg-emerald-500/10 border border-emerald-500/20 flex items-center justify-center mx-auto mb-4">
                  <span className="text-3xl">✓</span>
                </div>
                <h3 className="text-xl font-semibold text-white mb-2">Welcome to the Beta!</h3>
                <p className="text-[#737373] text-sm">Redirecting you now...</p>
              </div>
            )}

            {/* Step: Error */}
            {step === 'error' && (
              <div className="space-y-4">
                <button
                  onClick={handleReset}
                  className="w-full py-4 bg-white hover:bg-neutral-200 text-black font-semibold rounded-xl transition-all"
                >
                  Try Again
                </button>
              </div>
            )}
          </div>

          {/* Footer */}
          <p className="text-center text-[#404040] text-xs mt-6">
            <a
              href="https://x.com/intodotspace"
              target="_blank"
              rel="noopener noreferrer"
              className="text-[#737373] hover:text-white transition-colors"
            >
              Follow us on X
            </a>
          </p>
        </div>
      </div>
    </>
  );
}
