#!/usr/bin/env node
/**
 * Migrate: exécuter le schéma complet
 * Usage: node db/migrate.js
 */
import 'dotenv/config'
import { sql } from './index.js'

if (!process.env.DATABASE_URL) {
  console.error('DATABASE_URL required')
  process.exit(1)
}

const run = async (stmt) => {
  const q = Object.assign([stmt], { raw: [stmt] })
  return sql(q)
}

const statements = [
  `CREATE TABLE IF NOT EXISTS users (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    email VARCHAR(255) UNIQUE NOT NULL,
    password_hash VARCHAR(255) NOT NULL,
    name VARCHAR(255) NOT NULL,
    role VARCHAR(50) NOT NULL DEFAULT 'member',
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
  )`,
  `CREATE TABLE IF NOT EXISTS user_pages (
    user_id UUID REFERENCES users(id) ON DELETE CASCADE,
    page_id VARCHAR(50) NOT NULL,
    PRIMARY KEY (user_id, page_id)
  )`,
  `CREATE TABLE IF NOT EXISTS workspaces (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name TEXT NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW()
  )`,
  `CREATE TABLE IF NOT EXISTS workspace_members (
    workspace_id UUID REFERENCES workspaces(id) ON DELETE CASCADE,
    user_id UUID REFERENCES users(id) ON DELETE CASCADE,
    role VARCHAR(50) NOT NULL DEFAULT 'owner',
    created_at TIMESTAMPTZ DEFAULT NOW(),
    PRIMARY KEY (workspace_id, user_id)
  )`,
  `CREATE INDEX IF NOT EXISTS idx_workspace_members_user ON workspace_members(user_id)`,
  `CREATE TABLE IF NOT EXISTS sync_runs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    synced_at TIMESTAMPTZ DEFAULT NOW(),
    date_since DATE NOT NULL,
    date_until DATE NOT NULL,
    status VARCHAR(20) DEFAULT 'success',
    campaigns_count INT DEFAULT 0,
    error_message TEXT
  )`,
  `ALTER TABLE sync_runs ADD COLUMN IF NOT EXISTS workspace_id UUID`,
  `CREATE INDEX IF NOT EXISTS idx_sync_runs_workspace_date ON sync_runs(workspace_id, date_until)`,
  `CREATE TABLE IF NOT EXISTS campaigns (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    sync_run_id UUID REFERENCES sync_runs(id) ON DELETE SET NULL,
    account_id VARCHAR(100),
    account_name VARCHAR(255),
    campaign_id VARCHAR(100),
    campaign_name TEXT,
    date DATE,
    spend DECIMAL(12, 2) DEFAULT 0,
    impressions INT DEFAULT 0,
    clicks INT DEFAULT 0,
    code_country VARCHAR(10),
    product_name VARCHAR(255),
    product_with_animal VARCHAR(255),
    animal VARCHAR(50),
    type VARCHAR(100),
    raw TEXT,
    naming_date VARCHAR(50),
    created_at TIMESTAMPTZ DEFAULT NOW()
  )`,
  `ALTER TABLE campaigns ADD COLUMN IF NOT EXISTS workspace_id UUID`,
  `CREATE INDEX IF NOT EXISTS idx_campaigns_date ON campaigns(date)`,
  `CREATE INDEX IF NOT EXISTS idx_campaigns_account ON campaigns(account_name)`,
  `CREATE INDEX IF NOT EXISTS idx_campaigns_country ON campaigns(code_country)`,
  `CREATE INDEX IF NOT EXISTS idx_campaigns_workspace_date ON campaigns(workspace_id, date)`,
  `CREATE TABLE IF NOT EXISTS ads_raw (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    sync_run_id UUID REFERENCES sync_runs(id) ON DELETE SET NULL,
    ad_id VARCHAR(100),
    ad_name TEXT,
    account_id VARCHAR(100),
    account_name VARCHAR(255),
    campaign_id VARCHAR(100),
    date DATE,
    spend DECIMAL(12, 2) DEFAULT 0,
    impressions INT DEFAULT 0,
    clicks INT DEFAULT 0,
    purchase_value DECIMAL(12, 2) DEFAULT 0,
    purchase_count INT DEFAULT 0,
    created_at TIMESTAMPTZ DEFAULT NOW()
  )`,
  `ALTER TABLE ads_raw ADD COLUMN IF NOT EXISTS workspace_id UUID`,
  `CREATE INDEX IF NOT EXISTS idx_ads_raw_date ON ads_raw(date)`,
  `ALTER TABLE ads_raw ADD COLUMN IF NOT EXISTS purchase_count INT DEFAULT 0`,
  `CREATE INDEX IF NOT EXISTS idx_ads_raw_workspace_date ON ads_raw(workspace_id, date)`,
  `CREATE TABLE IF NOT EXISTS settings (
    key VARCHAR(100) PRIMARY KEY,
    value TEXT,
    updated_at TIMESTAMPTZ DEFAULT NOW()
  )`,
  `ALTER TABLE settings ADD COLUMN IF NOT EXISTS workspace_id UUID`,
  `CREATE INDEX IF NOT EXISTS idx_settings_workspace_key ON settings(workspace_id, key)`,
  `CREATE TABLE IF NOT EXISTS campaign_budgets (
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
  )`,
  `ALTER TABLE campaign_budgets ADD COLUMN IF NOT EXISTS workspace_id UUID`,
  `CREATE INDEX IF NOT EXISTS idx_campaign_budgets_workspace ON campaign_budgets(workspace_id, account_id)`,
]

for (const stmt of statements) {
  try {
    await sql([stmt])
    console.log('✓', stmt.slice(0, 60) + '...')
  } catch (err) {
    if (err.code === '42P07' || err.message?.includes('already exists')) console.log('- exists, skip')
    else throw err
  }
}
console.log('✓ Migration terminée')
