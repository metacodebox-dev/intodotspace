import * as fs from 'fs';
import * as path from 'path';

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

/**
 * Load IDL from file system
 * In production, you might load from a URL or IPFS
 */
export async function loadIDL(): Promise<any> {
  try {
    // Try multiple paths to find the IDL file (prioritize target/idl for latest build)
    const possiblePaths = [
      // From target/idl (latest build output)
      path.join(process.cwd(), 'target/idl/space_core.json'),
      path.join(process.cwd(), '../target/idl/space_core.json'),
      path.join(__dirname, '../../target/idl/space_core.json'),
      path.join(__dirname, '../../../target/idl/space_core.json'),
      // From backend/src/idl (backup)
      path.join(process.cwd(), 'src/idl/space_core.json'),
      path.join(__dirname, '../idl/space_core.json'),
      // From frontend/src/idl (legacy)
      path.join(process.cwd(), 'frontend/src/idl/space_core.json'),
      path.join(process.cwd(), '../frontend/src/idl/space_core.json'),
      path.join(__dirname, '../../frontend/src/idl/space_core.json'),
      path.join(__dirname, '../../../frontend/src/idl/space_core.json'),
    ];
    
    for (const idlPath of possiblePaths) {
      if (fs.existsSync(idlPath)) {
        const idlData = fs.readFileSync(idlPath, 'utf-8');
        const idl = JSON.parse(idlData);
        
        // Ensure IDL is a plain object (not a module wrapper)
        const plainIdl = JSON.parse(JSON.stringify(idl));
        
        // Validate IDL structure
        if (!plainIdl || typeof plainIdl !== 'object') {
          throw new Error('IDL is not a valid object');
        }
        
        if (!plainIdl.instructions || !Array.isArray(plainIdl.instructions)) {
          throw new Error('IDL missing instructions array');
        }
        
        // Ensure IDL has address field (required for Anchor 0.31+)
        if (!plainIdl.address) {
          const programId = getIDLProgramId(plainIdl);
          if (programId) {
            plainIdl.address = programId;
          }
        }
        
        console.log(`[IDL] Loaded from: ${idlPath}`, {
          hasAddress: !!plainIdl.address,
          hasMetadata: !!plainIdl.metadata,
          instructionCount: plainIdl.instructions?.length || 0,
          hasAccounts: !!plainIdl.accounts,
          accountCount: plainIdl.accounts?.length || 0,
        });
        
        return plainIdl;
      }
    }
    
    console.error('[IDL] File not found. Tried paths:');
    possiblePaths.forEach(p => console.error(`   - ${p}`));
    throw new Error(`IDL file not found. Please ensure target/idl/space_core.json exists.`);
  } catch (error) {
    console.error('Failed to load IDL:', error);
    throw error;
  }
}


