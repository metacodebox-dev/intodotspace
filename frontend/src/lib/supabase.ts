import { createClient } from '@supabase/supabase-js';

// Supabase configuration
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || '';
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || '';

if (!supabaseUrl || !supabaseAnonKey) {
  console.warn('Supabase credentials not configured. Image upload will be disabled.');
}

// Create Supabase client with optimized settings for scalability
export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  auth: {
    persistSession: false, // We manage auth separately via SIWS
    autoRefreshToken: false,
  },
  global: {
    headers: {
      'x-client-info': 'space-prediction-market',
    },
  },
});

// Storage bucket name for market images
export const MARKET_IMAGES_BUCKET = 'market-images';

// Image upload constraints
export const IMAGE_CONSTRAINTS = {
  maxSize: 5 * 1024 * 1024, // 5MB max
  allowedTypes: ['image/jpeg', 'image/png', 'image/webp', 'image/gif'],
  targetWidth: 800, // 1:1 aspect ratio
  targetHeight: 800,
  quality: 0.85,
} as const;

/**
 * Check if Supabase is properly configured
 */
export function isSupabaseConfigured(): boolean {
  return Boolean(supabaseUrl && supabaseAnonKey);
}
