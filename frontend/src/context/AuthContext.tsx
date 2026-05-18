'use client';

import React, { createContext, useContext, useState, useEffect, useCallback, useRef, ReactNode } from 'react';
import { useWallet } from '@solana/wallet-adapter-react';
import bs58 from 'bs58';

// API base URL - configure for your environment
const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001';

interface User {
  walletAddress: string;
}

interface AuthState {
  isAuthenticated: boolean;
  isLoading: boolean;
  user: User | null;
  token: string | null;
  error: string | null;
  tokenExpired: boolean;
}

interface AuthContextValue extends AuthState {
  signIn: () => Promise<boolean>;
  signOut: () => Promise<void>;
  signOutAndDisconnect: () => Promise<void>;
  checkAuth: () => Promise<boolean>;
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

const TOKEN_STORAGE_KEY = 'space_auth_token';
const WALLET_STORAGE_KEY = 'space_auth_wallet';

interface AuthProviderProps {
  children: ReactNode;
}

export function AuthProvider({ children }: AuthProviderProps) {
  const { connected, publicKey, signMessage, disconnect } = useWallet();
  
  const [state, setState] = useState<AuthState>({
    isAuthenticated: false,
    isLoading: true,
    user: null,
    token: null,
    error: null,
    tokenExpired: false,
  });

  // Refs to track state without causing re-renders
  const lastWalletRef = useRef<string | null>(null);
  const signInInProgress = useRef(false);
  const initializedRef = useRef(false);

  // Verify stored token with backend
  const verifyStoredToken = async (token: string): Promise<boolean> => {
    try {
      const response = await fetch(`${API_BASE_URL}/api/auth/me`, {
        method: 'GET',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
      });

      if (response.ok) {
        const data = await response.json();
        return data.authenticated === true;
      }

      return false;
    } catch (error) {
      console.error('Token verification error:', error);
      return false;
    }
  };

  // Silently refresh the token — returns new token or null on failure
  const refreshToken = async (currentToken: string): Promise<string | null> => {
    try {
      const response = await fetch(`${API_BASE_URL}/api/auth/refresh`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${currentToken}`,
          'Content-Type': 'application/json',
        },
      });

      if (response.ok) {
        const data = await response.json();
        if (data.success && data.token) {
          localStorage.setItem(TOKEN_STORAGE_KEY, data.token);
          setState(prev => ({ ...prev, token: data.token }));
          return data.token;
        }
      }
      return null;
    } catch {
      return null;
    }
  };

  // Auto-refresh: refresh token every 7 days while the user is active
  useEffect(() => {
    if (!state.token || !state.isAuthenticated) return;

    // Refresh every 7 days (token lasts 30 days, so this gives plenty of margin)
    const REFRESH_INTERVAL = 7 * 24 * 60 * 60 * 1000;
    const interval = setInterval(() => {
      if (state.token) {
        refreshToken(state.token);
      }
    }, REFRESH_INTERVAL);

    return () => clearInterval(interval);
  }, [state.token, state.isAuthenticated]);

  // Perform the actual sign-in flow
  const performSignIn = async (walletAddress: string): Promise<boolean> => {
    if (!signMessage || !publicKey) return false;
    
    // Prevent multiple concurrent sign-ins
    if (signInInProgress.current) {
      console.log('[Auth] Sign-in already in progress, skipping');
      return false;
    }
    
    signInInProgress.current = true;
    setState(prev => ({ ...prev, isLoading: true, error: null }));

    try {
      // Step 1: Request nonce from backend
      const nonceResponse = await fetch(`${API_BASE_URL}/api/auth/nonce`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ walletAddress }),
      });

      if (!nonceResponse.ok) {
        throw new Error('Failed to get nonce');
      }

      const { nonce, message } = await nonceResponse.json();

      // Step 2: Sign the message with wallet
      const messageBytes = new TextEncoder().encode(message);
      const signatureBytes = await signMessage(messageBytes);
      const signature = bs58.encode(signatureBytes);

      // Step 3: Verify signature with backend
      const verifyResponse = await fetch(`${API_BASE_URL}/api/auth/verify`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ walletAddress, message, signature, nonce }),
      });

      if (!verifyResponse.ok) {
        throw new Error('Signature verification failed');
      }

      const { token, user } = await verifyResponse.json();

      // Store token and wallet address
      localStorage.setItem(TOKEN_STORAGE_KEY, token);
      localStorage.setItem(WALLET_STORAGE_KEY, walletAddress);

      setState({
        isAuthenticated: true,
        isLoading: false,
        user,
        token,
        error: null,
        tokenExpired: false,
      });

      console.log('[Auth] Sign-in successful for wallet:', walletAddress.slice(0, 8));
      return true;
    } catch (error) {
      console.error('[Auth] Sign-in error:', error);
      setState(prev => ({
        ...prev,
        isLoading: false,
        error: null, // Don't show error for auto sign-in
      }));
      return false;
    } finally {
      signInInProgress.current = false;
    }
  };

  // Main effect: Handle wallet connection, disconnection, and account changes
  useEffect(() => {
    const currentWallet = publicKey?.toString() || null;
    const storedWallet = typeof window !== 'undefined' ? localStorage.getItem(WALLET_STORAGE_KEY) : null;
    const storedToken = typeof window !== 'undefined' ? localStorage.getItem(TOKEN_STORAGE_KEY) : null;

    const handleAuth = async () => {
      // Case 1: Wallet disconnected
      if (!connected || !publicKey) {
        // Track if we had a wallet before (for detecting "change wallet" flow)
        const hadWalletBefore = lastWalletRef.current !== null;
        
        if (hadWalletBefore) {
          console.log('[Auth] Wallet disconnected');
          localStorage.removeItem(TOKEN_STORAGE_KEY);
          localStorage.removeItem(WALLET_STORAGE_KEY);
          sessionStorage.removeItem('profile_avatar');
        }
        lastWalletRef.current = null;
        setState({
          isAuthenticated: false,
          isLoading: false,
          user: null,
          token: null,
          error: null,
          tokenExpired: false,
        });
        initializedRef.current = true;
        return;
      }

      // Case 2: Wallet changed (different account) - storedWallet exists
      if (storedWallet && currentWallet && storedWallet !== currentWallet) {
        console.log('[Auth] Wallet changed from', storedWallet.slice(0, 8), 'to', currentWallet.slice(0, 8));
        
        // Clear old session
        localStorage.removeItem(TOKEN_STORAGE_KEY);
        localStorage.removeItem(WALLET_STORAGE_KEY);
        sessionStorage.removeItem('profile_avatar');
        
        lastWalletRef.current = currentWallet;
        
        // Reset state and trigger new sign-in
        setState({
          isAuthenticated: false,
          isLoading: false,
          user: null,
          token: null,
          error: null,
          tokenExpired: false,
        });
        
        // Small delay then trigger sign-in for new wallet
        await new Promise(resolve => setTimeout(resolve, 500));
        await performSignIn(currentWallet);
        return;
      }

      // Case 3: Have stored token for this wallet - verify it
      if (storedToken && storedWallet === currentWallet) {
        console.log('[Auth] Verifying stored token...');
        lastWalletRef.current = currentWallet;

        const isValid = await verifyStoredToken(storedToken);

        if (isValid) {
          console.log('[Auth] Token valid, user authenticated');
          setState({
            isAuthenticated: true,
            isLoading: false,
            user: { walletAddress: currentWallet },
            token: storedToken,
            error: null,
            tokenExpired: false,
          });
          initializedRef.current = true;

          // Proactively refresh if token is older than 7 days
          try {
            const payload = JSON.parse(atob(storedToken.split('.')[1]));
            const tokenAge = Date.now() / 1000 - payload.iat;
            if (tokenAge > 7 * 24 * 60 * 60) {
              console.log('[Auth] Token older than 7 days, refreshing...');
              refreshToken(storedToken);
            }
          } catch {}

          return;
        } else {
          console.log('[Auth] Token invalid/expired');
          localStorage.removeItem(TOKEN_STORAGE_KEY);
          localStorage.removeItem(WALLET_STORAGE_KEY);
          setState(prev => ({
            ...prev,
            isLoading: false,
            tokenExpired: true,
          }));
          initializedRef.current = true;
          return;
        }
      }

      // Case 4: Fresh wallet connection (no stored token)
      // This handles: first connection, change wallet flow, returning after disconnect
      if (!storedToken && currentWallet) {
        const previousWallet = lastWalletRef.current;
        const walletChanged = previousWallet !== null && previousWallet !== currentWallet;
        const isFirstConnection = previousWallet === null && !initializedRef.current;
        const isNewWalletAfterDisconnect = previousWallet === null && initializedRef.current;
        
        lastWalletRef.current = currentWallet;
        
        // Auto sign-in for: first connection, wallet change, or new wallet after using "Change Wallet"
        if (isFirstConnection || walletChanged || isNewWalletAfterDisconnect) {
          console.log('[Auth] New wallet connected, triggering sign-in...', {
            isFirstConnection,
            walletChanged,
            isNewWalletAfterDisconnect
          });
          setState(prev => ({ ...prev, isLoading: false }));
          
          // Small delay to ensure wallet is ready
          await new Promise(resolve => setTimeout(resolve, 500));
          await performSignIn(currentWallet);
        } else {
          console.log('[Auth] No token, showing sign-in button');
          setState(prev => ({
            ...prev,
            isLoading: false,
          }));
        }
        initializedRef.current = true;
        return;
      }

      // Default: Set loading to false
      lastWalletRef.current = currentWallet;
      setState(prev => ({ ...prev, isLoading: false }));
      initializedRef.current = true;
    };

    handleAuth();
  }, [connected, publicKey]); // Only depend on wallet state, not signMessage

  // Sign in manually (exposed to components)
  const signIn = useCallback(async (): Promise<boolean> => {
    if (!connected || !publicKey || !signMessage) {
      setState(prev => ({
        ...prev,
        error: 'Wallet not connected or does not support message signing',
      }));
      return false;
    }

    return performSignIn(publicKey.toString());
  }, [connected, publicKey, signMessage]);

  // Sign out (keeps wallet connected)
  const signOut = useCallback(async (): Promise<void> => {
    try {
      if (state.token) {
        await fetch(`${API_BASE_URL}/api/auth/logout`, {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${state.token}`,
            'Content-Type': 'application/json',
          },
        });
      }
    } catch (error) {
      console.error('Sign out error:', error);
    } finally {
      localStorage.removeItem(TOKEN_STORAGE_KEY);
      localStorage.removeItem(WALLET_STORAGE_KEY);
      sessionStorage.removeItem('profile_avatar');
      
      setState({
        isAuthenticated: false,
        isLoading: false,
        user: null,
        token: null,
        error: null,
        tokenExpired: false,
      });
    }
  }, [state.token]);

  // Sign out AND disconnect wallet
  const signOutAndDisconnect = useCallback(async (): Promise<void> => {
    try {
      if (state.token) {
        await fetch(`${API_BASE_URL}/api/auth/logout`, {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${state.token}`,
            'Content-Type': 'application/json',
          },
        });
      }
    } catch (error) {
      console.error('Sign out error:', error);
    } finally {
      localStorage.removeItem(TOKEN_STORAGE_KEY);
      localStorage.removeItem(WALLET_STORAGE_KEY);
      sessionStorage.removeItem('profile_avatar');
      
      setState({
        isAuthenticated: false,
        isLoading: false,
        user: null,
        token: null,
        error: null,
        tokenExpired: false,
      });

      try {
        await disconnect();
      } catch (err) {
        console.error('Failed to disconnect wallet:', err);
      }
    }
  }, [state.token, disconnect]);

  // Check if user is authenticated
  const checkAuth = useCallback(async (): Promise<boolean> => {
    if (!state.token) {
      return false;
    }

    try {
      const isValid = await verifyStoredToken(state.token);
      
      if (!isValid) {
        localStorage.removeItem(TOKEN_STORAGE_KEY);
        setState({
          isAuthenticated: false,
          isLoading: false,
          user: null,
          token: null,
          error: null,
          tokenExpired: true,
        });
      }

      return isValid;
    } catch (error) {
      return false;
    }
  }, [state.token]);

  const value: AuthContextValue = {
    ...state,
    signIn,
    signOut,
    signOutAndDisconnect,
    checkAuth,
  };

  return (
    <AuthContext.Provider value={value}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthContextValue {
  const context = useContext(AuthContext);
  
  if (context === undefined) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  
  return context;
}

export { AuthContext };
