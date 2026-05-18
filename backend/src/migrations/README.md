# Database Migrations

This directory contains SQL migration files that are automatically executed on server startup.

## How It Works

1. Migrations are executed in alphabetical order (by filename)
2. Each migration is tracked in the `migrations` table
3. Already executed migrations are skipped
4. Migrations run before Sequelize model sync

## Creating a New Migration

1. Create a new SQL file in this directory with a descriptive name:
   ```
   YYYYMMDD_description.sql
   ```
   
   Example: `20240101_create_orders_table.sql`

2. Use `CREATE TABLE IF NOT EXISTS` or `ALTER TABLE` statements
3. The migration will automatically run on next server start

## Migration File Format

```sql
-- Migration: migration_name
-- Description: What this migration does
-- Date: YYYY-MM-DD

-- Your SQL statements here
CREATE TABLE IF NOT EXISTS ...
```

## Best Practices

- Always use `IF NOT EXISTS` for idempotency
- Test migrations on a development database first
- Keep migrations small and focused
- Never modify existing migration files (create new ones instead)
- Use transactions where possible (PostgreSQL supports this)

## Manual Execution

If you need to run migrations manually:

```bash
# Using psql
psql $DATABASE_URL -f backend/src/migrations/create_orders_table.sql
```

Or use the migration runner:

```typescript
import { runMigrations } from './utils/migrations';
await runMigrations();
```






