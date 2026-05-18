import { useState, useCallback } from 'react';
import { supabase, MARKET_IMAGES_BUCKET, IMAGE_CONSTRAINTS, isSupabaseConfigured } from '@/lib/supabase';

interface UploadState {
  uploading: boolean;
  progress: number;
  error: string | null;
  url: string | null;
}

interface UseImageUploadReturn extends UploadState {
  upload: (file: File) => Promise<string | null>;
  reset: () => void;
  isConfigured: boolean;
}

/**
 * Compress and resize image to 1:1 aspect ratio
 * Optimized for scalability - reduces storage and bandwidth
 */
async function compressImage(file: File): Promise<Blob> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');

    if (!ctx) {
      reject(new Error('Could not get canvas context'));
      return;
    }

    img.onload = () => {
      // Calculate crop dimensions for 1:1 aspect ratio (center crop)
      const size = Math.min(img.width, img.height);
      const offsetX = (img.width - size) / 2;
      const offsetY = (img.height - size) / 2;

      // Set canvas to target size
      canvas.width = IMAGE_CONSTRAINTS.targetWidth;
      canvas.height = IMAGE_CONSTRAINTS.targetHeight;

      // Draw cropped and resized image
      ctx.drawImage(
        img,
        offsetX, offsetY, size, size, // Source crop
        0, 0, IMAGE_CONSTRAINTS.targetWidth, IMAGE_CONSTRAINTS.targetHeight // Destination
      );

      // Convert to blob with compression
      canvas.toBlob(
        (blob) => {
          if (blob) {
            resolve(blob);
          } else {
            reject(new Error('Failed to compress image'));
          }
        },
        'image/webp', // Use WebP for better compression
        IMAGE_CONSTRAINTS.quality
      );
    };

    img.onerror = () => reject(new Error('Failed to load image'));
    img.src = URL.createObjectURL(file);
  });
}

/**
 * Validate image file before upload
 */
function validateImage(file: File): string | null {
  if (!IMAGE_CONSTRAINTS.allowedTypes.includes(file.type as any)) {
    return `Invalid file type. Allowed: ${IMAGE_CONSTRAINTS.allowedTypes.join(', ')}`;
  }
  if (file.size > IMAGE_CONSTRAINTS.maxSize) {
    return `File too large. Maximum size: ${IMAGE_CONSTRAINTS.maxSize / 1024 / 1024}MB`;
  }
  return null;
}

/**
 * Generate unique file path for storage
 * Uses timestamp + random string for uniqueness at scale
 */
function generateFilePath(originalName: string): string {
  const timestamp = Date.now();
  const random = Math.random().toString(36).substring(2, 15);
  const extension = 'webp'; // Always convert to WebP
  return `markets/${timestamp}-${random}.${extension}`;
}

/**
 * Hook for uploading market images to Supabase Storage
 * Handles validation, compression, and upload with progress tracking
 */
export function useImageUpload(): UseImageUploadReturn {
  const [state, setState] = useState<UploadState>({
    uploading: false,
    progress: 0,
    error: null,
    url: null,
  });

  const reset = useCallback(() => {
    setState({
      uploading: false,
      progress: 0,
      error: null,
      url: null,
    });
  }, []);

  const upload = useCallback(async (file: File): Promise<string | null> => {
    // Check if Supabase is configured
    if (!isSupabaseConfigured()) {
      setState(prev => ({ ...prev, error: 'Image upload is not configured. Please set up Supabase credentials.' }));
      return null;
    }

    // Reset state
    setState({ uploading: true, progress: 0, error: null, url: null });

    try {
      // Validate file
      const validationError = validateImage(file);
      if (validationError) {
        setState(prev => ({ ...prev, uploading: false, error: validationError }));
        return null;
      }

      setState(prev => ({ ...prev, progress: 10 }));

      // Compress image
      const compressedBlob = await compressImage(file);
      setState(prev => ({ ...prev, progress: 40 }));

      // Generate file path
      const filePath = generateFilePath(file.name);

      // Upload to Supabase Storage
      const { data, error: uploadError } = await supabase.storage
        .from(MARKET_IMAGES_BUCKET)
        .upload(filePath, compressedBlob, {
          cacheControl: '31536000', // 1 year cache for CDN
          contentType: 'image/webp',
          upsert: true, // Allow overwriting if file exists
        });

      if (uploadError) {
        // Provide more helpful error messages
        if (uploadError.message.includes('Invalid Compact JWS') || uploadError.message.includes('Unauthorized')) {
          throw new Error('Storage not configured. Please check Supabase bucket permissions (must be public with INSERT policy for anon).');
        }
        if (uploadError.message.includes('Bucket not found')) {
          throw new Error('Storage bucket "market-images" not found. Please create it in Supabase dashboard.');
        }
        throw new Error(uploadError.message);
      }

      setState(prev => ({ ...prev, progress: 80 }));

      // Get public URL
      const { data: urlData } = supabase.storage
        .from(MARKET_IMAGES_BUCKET)
        .getPublicUrl(filePath);

      const publicUrl = urlData.publicUrl;

      setState({
        uploading: false,
        progress: 100,
        error: null,
        url: publicUrl,
      });

      return publicUrl;
    } catch (error: any) {
      const errorMessage = error.message || 'Failed to upload image';
      setState({
        uploading: false,
        progress: 0,
        error: errorMessage,
        url: null,
      });
      console.error('Image upload error:', error);
      return null;
    }
  }, []);

  return {
    ...state,
    upload,
    reset,
    isConfigured: isSupabaseConfigured(),
  };
}
