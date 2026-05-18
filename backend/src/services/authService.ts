import { PublicKey } from '@solana/web3.js';
import nacl from 'tweetnacl';
import jwt from 'jsonwebtoken';
import { randomBytes } from 'crypto';
import { getRedisClient } from '../config/redis';

// JWT secret - in production use environment variable
const JWT_SECRET = process.env.JWT_SECRET || 'space-prediction-market-jwt-secret-change-in-production';
const JWT_EXPIRES_IN = '30d';
const NONCE_TTL_SECONDS = 5 * 60; // 5 minutes

const nonceKey = (walletAddress: string) => `auth:nonce:${walletAddress.toLowerCase()}`;
const sessionKey = (token: string) => `auth:session:${token}`;

export interface AuthPayload {
  walletAddress: string;
  iat: number;
  exp: number;
}

export interface SIWSMessage {
  domain: string;
  address: string;
  statement: string;
  uri: string;
  version: string;
  chainId: string;
  nonce: string;
  issuedAt: string;
  expirationTime?: string;
}

export class AuthService {
  /**
   * Generate a unique nonce for wallet authentication
   */
  async generateNonce(walletAddress: string): Promise<string> {
    const nonce = randomBytes(32).toString('hex');
    await getRedisClient().set(nonceKey(walletAddress), nonce, 'EX', NONCE_TTL_SECONDS);
    return nonce;
  }

  /**
   * Get the stored nonce for a wallet address
   */
  async getNonce(walletAddress: string): Promise<string | null> {
    return getRedisClient().get(nonceKey(walletAddress));
  }

  /**
   * Create a SIWS message for the user to sign
   */
  createSIWSMessage(params: {
    domain: string;
    address: string;
    nonce: string;
    uri: string;
    statement?: string;
    chainId?: string;
  }): string {
    const now = new Date();
    const expirationTime = new Date(now.getTime() + NONCE_TTL_SECONDS * 1000);
    
    const message: SIWSMessage = {
      domain: params.domain,
      address: params.address,
      statement: params.statement || 'Sign in to Space Prediction Market',
      uri: params.uri,
      version: '1',
      chainId: params.chainId || 'devnet',
      nonce: params.nonce,
      issuedAt: now.toISOString(),
      expirationTime: expirationTime.toISOString(),
    };

    // Format as human-readable message
    return this.formatSIWSMessage(message);
  }

  /**
   * Format SIWS message as human-readable text
   */
  private formatSIWSMessage(message: SIWSMessage): string {
    let msg = `${message.domain} wants you to sign in with your Solana account:\n`;
    msg += `${message.address}\n\n`;
    
    if (message.statement) {
      msg += `${message.statement}\n\n`;
    }
    
    msg += `URI: ${message.uri}\n`;
    msg += `Version: ${message.version}\n`;
    msg += `Chain ID: ${message.chainId}\n`;
    msg += `Nonce: ${message.nonce}\n`;
    msg += `Issued At: ${message.issuedAt}`;
    
    if (message.expirationTime) {
      msg += `\nExpiration Time: ${message.expirationTime}`;
    }
    
    return msg;
  }

  /**
   * Verify a signed SIWS message
   */
  async verifySignature(params: {
    walletAddress: string;
    message: string;
    signature: string;
    nonce: string;
  }): Promise<boolean> {
    try {
      const { walletAddress, message, signature, nonce } = params;
      
      // Verify nonce matches
      const storedNonce = await this.getNonce(walletAddress);
      if (!storedNonce || storedNonce !== nonce) {
        console.error('Nonce mismatch or expired');
        return false;
      }

      // Verify the message contains the correct nonce
      if (!message.includes(`Nonce: ${nonce}`)) {
        console.error('Message does not contain correct nonce');
        return false;
      }

      // Verify the message contains the wallet address
      if (!message.includes(walletAddress)) {
        console.error('Message does not contain wallet address');
        return false;
      }

      // Decode the signature from base58
      const signatureBytes = this.base58ToBytes(signature);
      if (!signatureBytes || signatureBytes.length !== 64) {
        console.error('Invalid signature format');
        return false;
      }

      // Get the public key bytes
      const publicKey = new PublicKey(walletAddress);
      const publicKeyBytes = publicKey.toBytes();

      // Encode message as bytes
      const messageBytes = new TextEncoder().encode(message);

      // Verify signature using nacl
      const isValid = nacl.sign.detached.verify(
        messageBytes,
        signatureBytes,
        publicKeyBytes
      );

      if (isValid) {
        // Invalidate the nonce after successful verification
        await getRedisClient().del(nonceKey(walletAddress));
      }

      return isValid;
    } catch (error) {
      console.error('Signature verification error:', error);
      return false;
    }
  }

  /**
   * Generate a JWT token for authenticated user
   */
  generateToken(walletAddress: string): string {
    const payload: Omit<AuthPayload, 'iat' | 'exp'> = {
      walletAddress,
    };

    return jwt.sign(payload, JWT_SECRET, {
      expiresIn: JWT_EXPIRES_IN,
    });
  }

  /**
   * Verify and decode a JWT token
   */
  verifyToken(token: string): AuthPayload | null {
    try {
      const decoded = jwt.verify(token, JWT_SECRET) as AuthPayload;
      return decoded;
    } catch (error) {
      return null;
    }
  }

  /**
   * Store a session
   */
  async createSession(token: string, walletAddress: string): Promise<void> {
    const decoded = this.verifyToken(token);
    if (!decoded) return;

    const ttlSeconds = decoded.exp - Math.floor(Date.now() / 1000);
    if (ttlSeconds <= 0) return;

    await getRedisClient().set(sessionKey(token), walletAddress, 'EX', ttlSeconds);
  }

  /**
   * Check if a session is valid
   */
  async isSessionValid(token: string): Promise<boolean> {
    try {
      const exists = await getRedisClient().exists(sessionKey(token));
      return exists === 1;
    } catch (err) {
      console.error('[Auth] Redis error in isSessionValid:', err);
      return false;
    }
  }

  /**
   * Invalidate a session (logout)
   */
  async invalidateSession(token: string): Promise<void> {
    await getRedisClient().del(sessionKey(token));
  }

  /**
   * Get user from token
   */
  getUserFromToken(token: string): { walletAddress: string } | null {
    const payload = this.verifyToken(token);
    if (!payload) {
      return null;
    }
    return { walletAddress: payload.walletAddress };
  }

  /**
   * Convert base58 string to bytes
   */
  private base58ToBytes(base58: string): Uint8Array | null {
    try {
      const ALPHABET = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
      const bytes: number[] = [0];
      
      for (const char of base58) {
        const value = ALPHABET.indexOf(char);
        if (value === -1) {
          return null;
        }
        
        for (let i = 0; i < bytes.length; i++) {
          bytes[i] *= 58;
        }
        bytes[0] += value;
        
        let carry = 0;
        for (let i = 0; i < bytes.length; i++) {
          bytes[i] += carry;
          carry = bytes[i] >> 8;
          bytes[i] &= 0xff;
        }
        
        while (carry) {
          bytes.push(carry & 0xff);
          carry >>= 8;
        }
      }
      
      // Handle leading zeros
      for (const char of base58) {
        if (char === '1') {
          bytes.push(0);
        } else {
          break;
        }
      }
      
      return new Uint8Array(bytes.reverse());
    } catch (error) {
      return null;
    }
  }
}

// Export singleton instance
export const authService = new AuthService();
