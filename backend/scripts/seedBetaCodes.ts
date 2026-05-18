#!/usr/bin/env ts-node
/**
 * Beta Code Seed Script
 * 
 * CLI tool to seed beta codes into Redis.
 * 
 * Usage:
 *   npx ts-node scripts/seedBetaCodes.ts --file codes.txt
 *   npx ts-node scripts/seedBetaCodes.ts --codes "CODE1,CODE2,CODE3"
 *   npx ts-node scripts/seedBetaCodes.ts --generate 100
 *   npx ts-node scripts/seedBetaCodes.ts --generate 100 --prefix BETA
 *   npx ts-node scripts/seedBetaCodes.ts --list
 *   npx ts-node scripts/seedBetaCodes.ts --stats
 * 
 * Options:
 *   --file <path>      Import codes from text file (one per line)
 *   --codes <list>     Comma-separated list of codes
 *   --generate <n>     Generate n random codes
 *   --prefix <prefix>  Prefix for generated codes (default: BETA)
 *   --ttl <seconds>    Optional TTL for codes (default: no expiry)
 *   --list             List all existing codes (masked)
 *   --stats            Show statistics
 *   --dry-run          Don't actually seed, just show what would be done
 */

import * as dotenv from 'dotenv';
import * as fs from 'fs';
import * as path from 'path';
import * as readline from 'readline';
import { randomBytes } from 'crypto';

// Load environment variables
dotenv.config({ path: path.join(__dirname, '..', '.env') });

import { getRedisClient, closeRedis } from '../src/config/redis';
import { betaGateService } from '../src/betaGate/service';
import { BETA_KEYS, normalizeCode, maskCode } from '../src/betaGate/keys';

// Parse command line arguments
const args = process.argv.slice(2);
const options: Record<string, string | boolean> = {};

for (let i = 0; i < args.length; i++) {
  const arg = args[i];
  if (arg.startsWith('--')) {
    const key = arg.substring(2);
    const nextArg = args[i + 1];
    if (nextArg && !nextArg.startsWith('--')) {
      options[key] = nextArg;
      i++;
    } else {
      options[key] = true;
    }
  }
}

/**
 * Generate a random beta code
 */
function generateCode(prefix: string = 'BETA'): string {
  const random = randomBytes(6).toString('hex').toUpperCase();
  return `${prefix}-${random.substring(0, 4)}-${random.substring(4, 8)}`;
}

/**
 * Read codes from file
 */
async function readCodesFromFile(filePath: string): Promise<string[]> {
  const absolutePath = path.isAbsolute(filePath) 
    ? filePath 
    : path.join(process.cwd(), filePath);
  
  if (!fs.existsSync(absolutePath)) {
    throw new Error(`File not found: ${absolutePath}`);
  }

  const content = fs.readFileSync(absolutePath, 'utf-8');
  return content
    .split('\n')
    .map(line => line.trim())
    .filter(line => line && !line.startsWith('#'));
}

/**
 * List all beta codes in Redis
 */
async function listCodes(): Promise<void> {
  const redis = getRedisClient();
  const keys = await redis.keys('beta:code:*');
  
  console.log(`\nFound ${keys.length} beta codes:\n`);
  
  for (const key of keys) {
    const data = await redis.get(key);
    if (data) {
      const parsed = JSON.parse(data);
      const code = key.replace('beta:code:', '');
      console.log(`  ${maskCode(code)}: ${parsed.status}${parsed.wallet ? ` (${parsed.wallet.substring(0, 8)}...)` : ''}`);
    }
  }
}

/**
 * Show statistics
 */
async function showStats(): Promise<void> {
  const redis = getRedisClient();
  const keys = await redis.keys('beta:code:*');
  
  let valid = 0;
  let redeemed = 0;
  
  for (const key of keys) {
    const data = await redis.get(key);
    if (data) {
      const parsed = JSON.parse(data);
      if (parsed.status === 'valid') valid++;
      if (parsed.status === 'redeemed') redeemed++;
    }
  }

  const metrics = await betaGateService.getMetrics();

  console.log('\n=== Beta Gate Statistics ===\n');
  console.log(`Total Codes: ${keys.length}`);
  console.log(`Available: ${valid}`);
  console.log(`Redeemed: ${redeemed}`);
  console.log(`\nMetrics:`);
  console.log(`  Challenges Created: ${metrics.challenges_created}`);
  console.log(`  Successful Redemptions: ${metrics.successful_redemptions}`);
  console.log(`  Failed Attempts: ${metrics.failures}`);
  console.log(`  Rate Limited: ${metrics.rate_limited}`);
}

/**
 * Seed codes
 */
async function seedCodes(codes: string[], ttl?: number, dryRun: boolean = false): Promise<void> {
  console.log(`\nSeeding ${codes.length} codes${dryRun ? ' (DRY RUN)' : ''}...\n`);

  let added = 0;
  let skipped = 0;

  for (const code of codes) {
    const normalized = normalizeCode(code);
    
    if (dryRun) {
      console.log(`  [DRY RUN] Would seed: ${maskCode(code)}`);
      added++;
    } else {
      const success = await betaGateService.seedCode(code, ttl);
      if (success) {
        console.log(`  ✓ Added: ${maskCode(code)}`);
        added++;
      } else {
        console.log(`  - Skipped (exists): ${maskCode(code)}`);
        skipped++;
      }
    }
  }

  console.log(`\nResult: ${added} added, ${skipped} skipped`);
}

/**
 * Wait for Redis to be ready
 */
async function waitForRedis(maxRetries: number = 10): Promise<void> {
  const redis = getRedisClient();
  
  for (let i = 0; i < maxRetries; i++) {
    try {
      await redis.ping();
      console.log('[Redis] Connected successfully');
      return;
    } catch (error) {
      console.log(`[Redis] Waiting for connection... (attempt ${i + 1}/${maxRetries})`);
      await new Promise(resolve => setTimeout(resolve, 1000));
    }
  }
  
  throw new Error('Failed to connect to Redis after multiple attempts');
}

/**
 * Main function
 */
async function main(): Promise<void> {
  try {
    console.log('Beta Code Management Tool');
    console.log('========================\n');
    
    // Wait for Redis connection first
    await waitForRedis();

    // Handle --list
    if (options.list) {
      await listCodes();
      return;
    }

    // Handle --stats
    if (options.stats) {
      await showStats();
      return;
    }

    // Collect codes to seed
    let codes: string[] = [];

    // From file
    if (options.file) {
      console.log(`Reading codes from file: ${options.file}`);
      codes = await readCodesFromFile(options.file as string);
    }

    // From command line
    if (options.codes) {
      const cliCodes = (options.codes as string).split(',').map(c => c.trim());
      codes = [...codes, ...cliCodes];
    }

    // Generate random codes
    if (options.generate) {
      const count = parseInt(options.generate as string, 10);
      const prefix = (options.prefix as string) || 'BETA';
      
      console.log(`Generating ${count} codes with prefix: ${prefix}`);
      
      const generated: string[] = [];
      for (let i = 0; i < count; i++) {
        generated.push(generateCode(prefix));
      }
      codes = [...codes, ...generated];

      // Output generated codes to file if not dry-run
      if (!options['dry-run']) {
        const outputFile = `generated-codes-${Date.now()}.txt`;
        fs.writeFileSync(outputFile, generated.join('\n'));
        console.log(`Generated codes saved to: ${outputFile}`);
      }
    }

    if (codes.length === 0) {
      console.log('No codes to seed. Use --help for usage information.');
      console.log('\nExamples:');
      console.log('  npx ts-node scripts/seedBetaCodes.ts --generate 50');
      console.log('  npx ts-node scripts/seedBetaCodes.ts --file codes.txt');
      console.log('  npx ts-node scripts/seedBetaCodes.ts --codes "CODE1,CODE2"');
      console.log('  npx ts-node scripts/seedBetaCodes.ts --list');
      console.log('  npx ts-node scripts/seedBetaCodes.ts --stats');
      return;
    }

    // Parse TTL
    const ttl = options.ttl ? parseInt(options.ttl as string, 10) : undefined;

    // Seed codes
    await seedCodes(codes, ttl, !!options['dry-run']);

  } catch (error) {
    console.error('Error:', error);
    process.exit(1);
  } finally {
    await closeRedis();
    process.exit(0);
  }
}

// Run
main();
