#!/usr/bin/env node
/**
 * Migrate: créer la table campaign_budgets
 * Usage: node db/migrate-budgets.js  ou  npm run db:migrate-budgets
 */
import 'dotenv/config'
import { config } from 'dotenv'
import { join } from 'path'
import { fileURLToPath } from 'url'

const __dirname = fileURLToPath(new URL('.', import.meta.url))
if (!process.env.DATABASE_URL) {
  config({ path: join(__dirname, '../.env') })
}
if (!process.env.DATABASE_URL) {
  console.error('DATABASE_URL requis. Crée un fichier .env avec DATABASE_URL.')
  process.exit(1)
}

const { sql } = await import('./index.js')

try {
await sql`
  CREATE TABLE IF NOT EXISTS campaign_budgets (
    workspace_id UUID NOT NULL,
    account_id VARCHAR(100) NOT NULL,
    account_name VARCHAR(255),
    campaign_id VARCHAR(100) NOT NULL,
    campaign_name TEXT,
    daily_budget DECIMAL(12, 2) DEFAULT 0,
    lifetime_budget DECIMAL(12, 2) DEFAULT 0,
    effective_status VARCHAR(50),
    has_active_ads BOOLEAN,
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    PRIMARY KEY (workspace_id, account_id, campaign_id)
  )
`
  await sql`ALTER TABLE campaign_budgets ADD COLUMN IF NOT EXISTS workspace_id UUID`
  await sql`ALTER TABLE campaign_budgets ADD COLUMN IF NOT EXISTS effective_status VARCHAR(50)`
  await sql`ALTER TABLE campaign_budgets ADD COLUMN IF NOT EXISTS has_active_ads BOOLEAN`
  console.log('✓ Table campaign_budgets créée')
} catch (err) {
  console.error('Erreur migration:', err.message)
  process.exit(1)
}
