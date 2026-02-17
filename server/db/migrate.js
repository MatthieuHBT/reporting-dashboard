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
  `CREATE TABLE IF NOT EXISTS sync_runs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    synced_at TIMESTAMPTZ DEFAULT NOW(),
    date_since DATE NOT NULL,
    date_until DATE NOT NULL,
    status VARCHAR(20) DEFAULT 'success',
    campaigns_count INT DEFAULT 0,
    error_message TEXT
  )`,
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
  `CREATE INDEX IF NOT EXISTS idx_campaigns_date ON campaigns(date)`,
  `CREATE INDEX IF NOT EXISTS idx_campaigns_account ON campaigns(account_name)`,
  `CREATE INDEX IF NOT EXISTS idx_campaigns_country ON campaigns(code_country)`,
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
    created_at TIMESTAMPTZ DEFAULT NOW()
  )`,
  `CREATE INDEX IF NOT EXISTS idx_ads_raw_date ON ads_raw(date)`,
  `CREATE TABLE IF NOT EXISTS settings (
    key VARCHAR(100) PRIMARY KEY,
    value TEXT,
    updated_at TIMESTAMPTZ DEFAULT NOW()
  )`,
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
