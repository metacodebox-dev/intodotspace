/**
 * IDL Loader Utility
 * 
 * In production, load your IDL from:
 * 1. A public URL (e.g., IPFS, CDN)
 * 2. A local file
 * 3. Your backend API
 * 
 * Example:
 * 
 * import idl from '../idl/space_core.json';
 * 
 * Or fetch from URL:
 * 
 * const idl = await fetch('https://your-cdn.com/space_core.json').then(r => r.json());
 */

export async function loadIDL(): Promise<any> {
  try {
    // Import from local file - Next.js will handle JSON imports
    const idlModule = await import('../idl/space_core.json');
    
    // Extract IDL - handle various import formats
    let idl = idlModule;
    if (idlModule.default) {
      idl = idlModule.default;
    }
    
    // Ensure we have a plain object (not a module wrapper)
    // Deep clone to ensure it's a plain object
    const plainIdl = JSON.parse(JSON.stringify(idl));
    
    // Validate IDL structure
    if (!plainIdl || typeof plainIdl !== 'object') {
      throw new Error('IDL is not a valid object');
    }
    
    if (!plainIdl.instructions || !Array.isArray(plainIdl.instructions)) {
      throw new Error('IDL missing instructions array');
    }
    
    console.log('[IDL Loader] IDL loaded successfully:', {
      hasAddress: !!plainIdl.address,
      hasMetadata: !!plainIdl.metadata,
      instructionCount: plainIdl.instructions?.length || 0,
      hasTypes: !!plainIdl.types,
      typeCount: plainIdl.types?.length || 0,
    });
    
    return plainIdl;
  } catch (error) {
    console.error('[IDL Loader] Failed to load IDL:', error);
    if (error instanceof Error) {
      console.error('[IDL Loader] Error details:', {
        message: error.message,
        stack: error.stack,
      });
    }
    return null;
  }
}

/**
 * Extract program ID from IDL
 * Handles both old format (metadata.address) and new format (address at top level)
 */
export function getIDLProgramId(idl: any): string | null {
  if (!idl) return null;
  // New Anchor 0.30+ format: address at top level
  if (idl.address) return idl.address;
  // Old format: address in metadata
  if (idl.metadata?.address) return idl.metadata.address;
  return null;
}

