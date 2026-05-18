import { useCallback, useState, useRef } from 'react';
import Image from 'next/image';
import { useImageUpload } from '@/hooks/useImageUpload';

interface ImageUploadProps {
  value: string | null;
  onChange: (url: string | null) => void;
  className?: string;
  compact?: boolean; // Compact mode for inline use (e.g., per-outcome images)
}

export function ImageUpload({ value, onChange, className = '', compact = false }: ImageUploadProps) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [preview, setPreview] = useState<string | null>(value);
  const { upload, uploading, progress, error, isConfigured, reset } = useImageUpload();

  const handleFileSelect = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    // Create local preview immediately
    const localPreview = URL.createObjectURL(file);
    setPreview(localPreview);

    // Upload to Supabase
    const url = await upload(file);
    
    if (url) {
      onChange(url);
      // Clean up local preview
      URL.revokeObjectURL(localPreview);
    } else {
      // Upload failed, keep local preview but don't set URL
      setPreview(localPreview);
    }
  }, [upload, onChange]);

  const handleDrop = useCallback((e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    
    const file = e.dataTransfer.files?.[0];
    if (!file || !file.type.startsWith('image/')) return;

    // Simulate file input change
    const dataTransfer = new DataTransfer();
    dataTransfer.items.add(file);
    if (fileInputRef.current) {
      fileInputRef.current.files = dataTransfer.files;
      fileInputRef.current.dispatchEvent(new Event('change', { bubbles: true }));
    }
  }, []);

  const handleDragOver = useCallback((e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
  }, []);

  const handleRemove = useCallback(() => {
    setPreview(null);
    onChange(null);
    reset();
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  }, [onChange, reset]);

  const handleClick = useCallback(() => {
    fileInputRef.current?.click();
  }, []);

  // Use value prop as fallback if preview not set
  const displayImage = preview || value;

  if (!isConfigured) {
    return (
      <div className={`bg-space-gray-700 border border-space-gray-600 rounded-lg p-4 ${className}`}>
        <p className="text-space-gray-400 text-sm text-center">
          Image upload is not configured. Please add Supabase credentials to enable this feature.
        </p>
      </div>
    );
  }

  return (
    <div className={className}>
      <input
        ref={fileInputRef}
        type="file"
        accept="image/jpeg,image/png,image/webp,image/gif"
        onChange={handleFileSelect}
        className="hidden"
      />
      
      {displayImage ? (
        <div className="relative">
          {/* Image Preview */}
          <div
            className={`relative w-full ${compact ? 'h-full rounded-lg' : 'aspect-square rounded-xl'} overflow-hidden bg-space-gray-700 cursor-pointer group`}
            onClick={handleClick}
          >
            <Image
              src={displayImage}
              alt="Market image preview"
              fill
              className="object-cover"
            />
            
            {/* Overlay on hover */}
            <div className="absolute inset-0 bg-black/50 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
              <span className="text-white text-sm font-medium">Click to change</span>
            </div>

            {/* Upload progress overlay */}
            {uploading && (
              <div className="absolute inset-0 bg-black/70 flex flex-col items-center justify-center">
                <div className="w-3/4 h-2 bg-space-gray-600 rounded-full overflow-hidden">
                  <div 
                    className="h-full bg-space-primary transition-all duration-300"
                    style={{ width: `${progress}%` }}
                  />
                </div>
                <span className="text-white text-sm mt-2">{progress}%</span>
              </div>
            )}
          </div>

          {/* Remove button */}
          <button
            type="button"
            onClick={handleRemove}
            className={`absolute ${compact ? '-top-1 -right-1 w-4 h-4' : '-top-2 -right-2 w-6 h-6'} bg-space-danger rounded-full flex items-center justify-center hover:bg-red-600 transition-colors`}
          >
            <svg className="w-4 h-4 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
      ) : (
        <div
          onClick={handleClick}
          onDrop={handleDrop}
          onDragOver={handleDragOver}
          className={`w-full ${compact ? 'h-full rounded-lg border' : 'aspect-square rounded-xl border-2'} border-dashed border-space-gray-600 bg-space-gray-700 hover:border-space-primary hover:bg-space-gray-600 transition-all cursor-pointer flex flex-col items-center justify-center`}
        >
          {uploading ? (
            <div className="flex flex-col items-center">
              <div className={`${compact ? 'w-6 h-6 border-2' : 'w-16 h-16 border-4'} border-space-primary border-t-transparent rounded-full animate-spin ${compact ? 'mb-0' : 'mb-4'}`} />
              {!compact && <span className="text-space-gray-400 text-sm">Uploading... {progress}%</span>}
            </div>
          ) : compact ? (
            <svg className="w-5 h-5 text-space-gray-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
            </svg>
          ) : (
            <>
              <svg className="w-12 h-12 text-space-gray-500 mb-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
              </svg>
              <span className="text-space-gray-400 text-sm font-medium mb-1">Upload Image</span>
              <span className="text-space-gray-500 text-xs">1:1 ratio • Max 5MB</span>
              <span className="text-space-gray-500 text-xs">Drag & drop or click</span>
            </>
          )}
        </div>
      )}

      {/* Error message */}
      {error && (
        <p className="mt-2 text-space-danger text-sm">{error}</p>
      )}
    </div>
  );
}
