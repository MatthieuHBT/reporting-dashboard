#!/usr/bin/env node
/**
 * Fix: campaign_budgets doit avoir une PK/UNIQUE (workspace_id, account_id, campaign_id)
 * pour que ON CONFLICT (...) DO UPDATE fonctionne.
 * À lancer si vous avez l'erreur: "there is no unique or exclusion constraint matching the ON CONFLICT specification"
 *
 * Usage: node db/migrate-fix-campaign-budgets-pk.js
 */
import 'dotenv/config'
import { sql } from './index.js'

const run = async (stmt) => {
  const q = typeof stmt === 'string' ? Object.assign([stmt], { raw: [stmt] }) : stmt
  return sql(q)
}

async function getFirstWorkspaceId() {
  const rows = await sql`SELECT id FROM workspaces ORDER BY created_at ASC LIMIT 1`
  return rows?.[0]?.id ?? null
}

async function main() {
  if (!process.env.DATABASE_URL) {
    console.error('DATABASE_URL required')
    process.exit(1)
  }

  // 1) Créer la table si elle n'existe pas (avec la bonne PK)
  await run(`
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
  `).catch((e) => {
    if (e.code !== '42P07' && !e.message?.includes('already exists')) throw e
  })

  // 2) Ajouter workspace_id si la table existait sans
  await run(`ALTER TABLE campaign_budgets ADD COLUMN IF NOT EXISTS workspace_id UUID`).catch(() => {})

  // 3) Récupérer un workspace pour les lignes sans workspace_id
  let legacyId = await getFirstWorkspaceId()
  if (!legacyId) {
    await run(`CREATE EXTENSION IF NOT EXISTS pgcrypto`)
    await run(`
      CREATE TABLE IF NOT EXISTS workspaces (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        name TEXT NOT NULL,
        created_at TIMESTAMPTZ DEFAULT NOW()
      )
    `)
    const inserted = await sql`INSERT INTO workspaces (name) VALUES ('Legacy') RETURNING id`
    legacyId = inserted?.[0]?.id
  }
  if (!legacyId) throw new Error('Could not get or create workspace')

  // 4) Remplir workspace_id pour les lignes NULL
  await run(`UPDATE campaign_budgets SET workspace_id = '${legacyId}'::uuid WHERE workspace_id IS NULL`)

  // 5) Rendre workspace_id NOT NULL
  await run(`ALTER TABLE campaign_budgets ALTER COLUMN workspace_id SET NOT NULL`).catch(() => {})

  // 6) Supprimer l'ancienne PK (souvent account_id, campaign_id)
  await run(`
    DO $$
    DECLARE c TEXT;
    BEGIN
      SELECT tc.constraint_name INTO c
      FROM information_schema.table_constraints tc
      WHERE tc.table_schema = 'public'
        AND tc.table_name = 'campaign_budgets'
        AND tc.constraint_type = 'PRIMARY KEY'
      LIMIT 1;
      IF c IS NOT NULL THEN
        EXECUTE format('ALTER TABLE campaign_budgets DROP CONSTRAINT %I', c);
      END IF;
    END $$;
  `)

  // 7) Ajouter la nouvelle PK
  await run(`
    ALTER TABLE campaign_budgets
    ADD PRIMARY KEY (workspace_id, account_id, campaign_id)
  `).catch((e) => {
    if (e.code === '42P16' || e.message?.includes('already exists')) return
    throw e
  })

  await run(`CREATE INDEX IF NOT EXISTS idx_campaign_budgets_workspace ON campaign_budgets(workspace_id, account_id)`)

  console.log('✓ campaign_budgets: PK (workspace_id, account_id, campaign_id) OK')
}

main().catch((e) => {
  console.error('Erreur:', e?.message || e)
  process.exit(1)
})
