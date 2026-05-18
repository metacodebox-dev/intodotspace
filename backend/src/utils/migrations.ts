import { sequelize } from '../config/database';
import { readFileSync, readdirSync } from 'fs';
import { join } from 'path';
import { QueryTypes } from 'sequelize';

interface Migration {
  name: string;
  file: string;
  executed: boolean;
}

/**
 * Create migrations table if it doesn't exist
 */
async function ensureMigrationsTable() {
  await sequelize.query(`
    CREATE TABLE IF NOT EXISTS migrations (
      id SERIAL PRIMARY KEY,
      name VARCHAR(255) UNIQUE NOT NULL,
      executed_at TIMESTAMP NOT NULL DEFAULT NOW()
    );
  `, { type: QueryTypes.RAW });
}

/**
 * Get list of executed migrations
 */
async function getExecutedMigrations(): Promise<string[]> {
  try {
    const results = await sequelize.query(
      'SELECT name FROM migrations ORDER BY executed_at ASC',
      { type: QueryTypes.SELECT }
    ) as Array<{ name: string }>;

    return results.map(r => r.name);
  } catch (error) {
    // Table doesn't exist yet or query failed — reset connection state
    try {
      await sequelize.query('SELECT 1', { type: QueryTypes.SELECT });
    } catch (_) {
      // ignore — just clearing the connection
    }
    return [];
  }
}

/**
 * Mark a migration as executed
 */
async function markMigrationExecuted(name: string, transaction?: any) {
  await sequelize.query(
    'INSERT INTO migrations (name) VALUES (:name) ON CONFLICT (name) DO NOTHING',
    {
      replacements: { name },
      type: QueryTypes.INSERT,
      transaction,
    }
  );
}

/**
 * Execute a single migration SQL file
 */
async function executeMigration(filePath: string, name: string): Promise<void> {
  try {
    const sql = readFileSync(filePath, 'utf-8');

    // Remove comments and clean up SQL
    const cleanedSql = sql
      .split('\n')
      .filter(line => {
        const trimmed = line.trim();
        // Keep lines that are not comments or empty
        return trimmed.length > 0 && !trimmed.startsWith('--');
      })
      .join('\n');

    // Execute the SQL (split by semicolons for multiple statements)
    const statements = cleanedSql
      .split(';')
      .map(s => s.trim())
      .filter(s => s.length > 0);

    // Execute each statement independently (DDL is auto-committed in PostgreSQL)
    // Using individual queries instead of a managed transaction avoids 25P02 errors
    for (const statement of statements) {
      if (statement.trim()) {
        try {
          await sequelize.query(statement, { type: QueryTypes.RAW });
        } catch (stmtError: any) {
          // Ignore safe errors for idempotent DDL
          const code = stmtError?.parent?.code || stmtError?.original?.code;
          if (code === '42701' || code === '42P07' || code === '42710') {
            // 42701 = column already exists, 42P07 = relation already exists, 42710 = index already exists
            console.log(`[Migration] Skipping (already applied): ${statement.substring(0, 60)}...`);
          } else if (code === '42P01') {
            // 42P01 = relation does not exist — table not created yet, skip this migration
            console.log(`[Migration] Skipping (table not yet created): ${statement.substring(0, 60)}...`);
          } else {
            throw stmtError;
          }
        }
      }
    }

    // Mark as executed
    await markMigrationExecuted(name);

    console.log(`[Migration] Executed: ${name}`);
  } catch (error) {
    console.error(`[Migration] Error executing ${name}:`, error);
    throw error;
  }
}

/**
 * Run all pending migrations
 */
export async function runMigrations(): Promise<void> {
  try {
    console.log('[Migration] Running database migrations...');
    
    await ensureMigrationsTable();
    
    const migrationsDir = join(__dirname, '../migrations');
    
    try {
      readdirSync(migrationsDir);
    } catch (error) {
      console.log('[Migration] Directory not found, skipping');
      return;
    }
    
    const files = readdirSync(migrationsDir)
      .filter(file => file.endsWith('.sql'))
      .sort();
    
    if (files.length === 0) {
      console.log('[Migration] No migrations found');
      return;
    }
    
    const executed = await getExecutedMigrations();
    
    let executedCount = 0;
    for (const file of files) {
      const name = file.replace('.sql', '');
      
      if (!executed.includes(name)) {
        const filePath = join(migrationsDir, file);
        await executeMigration(filePath, name);
        executedCount++;
      } else {
        console.log(`[Migration] Already executed: ${name}`);
      }
    }
    
    if (executedCount > 0) {
      console.log(`[Migration] ${executedCount} migration(s) executed`);
    } else {
      console.log('[Migration] All migrations up to date');
    }
  } catch (error) {
    console.error('[Migration] Failed:', error);
    throw error;
  }
}

