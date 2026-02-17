#!/usr/bin/env node
/**
 * Migrate: créer la table settings
 * Usage: node db/migrate-settings.js
 */
import 'dotenv/config'
import { sql } from './index.js'

if (!process.env.DATABASE_URL) {
  console.error('DATABASE_URL required')
  process.exit(1)
}

await sql`
  CREATE TABLE IF NOT EXISTS settings (
    key VARCHAR(100) PRIMARY KEY,
    value TEXT,
    updated_at TIMESTAMPTZ DEFAULT NOW()
  )
`
console.log('✓ Table settings créée')
