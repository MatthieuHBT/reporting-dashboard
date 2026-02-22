#!/usr/bin/env node
/**
 * Migration SaaS (multi-tenant) pour une DB existante.
 *
 * - Ajoute workspaces + workspace_members
 * - Ajoute workspace_id aux tables existantes
 * - Crée un workspace "Legacy" et backfill toutes les anciennes rows dessus
 * - Met à jour les PK pour settings et campaign_budgets afin d’être multi-tenant
 *
 * Usage: node db/migrate-saas.js
 */
import 'dotenv/config'
import { sql } from './index.js'

if (!process.env.DATABASE_URL) {
  console.error('DATABASE_URL required')
  process.exit(1)
}

async function run(stmt) {
  await sql([stmt])
}

async function getSingleValue(q) {
  const rows = await sql(q)
  const first = rows?.[0]
  if (!first) return null
  const k = Object.keys(first)[0]
  return first[k]
}

async function ensureLegacyWorkspace() {
  await run(`CREATE EXTENSION IF NOT EXISTS pgcrypto`)
  await run(`
    CREATE TABLE IF NOT EXISTS workspaces (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      name TEXT NOT NULL,
      created_at TIMESTAMPTZ DEFAULT NOW()
    )
  `)
  await run(`
    CREATE TABLE IF NOT EXISTS workspace_members (
      workspace_id UUID REFERENCES workspaces(id) ON DELETE CASCADE,
      user_id UUID REFERENCES users(id) ON DELETE CASCADE,
      role VARCHAR(50) NOT NULL DEFAULT 'owner',
      created_at TIMESTAMPTZ DEFAULT NOW(),
      PRIMARY KEY (workspace_id, user_id)
    )
  `)
  await run(`CREATE INDEX IF NOT EXISTS idx_workspace_members_user ON workspace_members(user_id)`)

  const legacyId = await getSingleValue(sql`SELECT id FROM workspaces WHERE name = 'Legacy' ORDER BY created_at ASC LIMIT 1`)
  if (legacyId) return legacyId

  const created = await sql`INSERT INTO workspaces (name) VALUES ('Legacy') RETURNING id`
  return created?.[0]?.id
}

async function backfillWorkspaceMembers(legacyWorkspaceId) {
  // Ajoute tous les users existants au workspace Legacy (admin → owner, sinon member)
  await run(`
    INSERT INTO workspace_members (workspace_id, user_id, role)
    SELECT '${legacyWorkspaceId}'::uuid, u.id,
      CASE WHEN LOWER(COALESCE(u.role, '')) = 'admin' THEN 'owner' ELSE 'member' END
    FROM users u
    ON CONFLICT (workspace_id, user_id) DO NOTHING
  `)
}

async function addWorkspaceIdColumn(table) {
  await run(`ALTER TABLE ${table} ADD COLUMN IF NOT EXISTS workspace_id UUID`)
  await run(`CREATE INDEX IF NOT EXISTS idx_${table}_workspace_id ON ${table}(workspace_id)`)
}

async function backfillWorkspaceId(table, legacyWorkspaceId) {
  await run(`UPDATE ${table} SET workspace_id = '${legacyWorkspaceId}'::uuid WHERE workspace_id IS NULL`)
}

async function dropPrimaryKey(table) {
  await run(`
    DO $$
    DECLARE c TEXT;
    BEGIN
      SELECT tc.constraint_name INTO c
      FROM information_schema.table_constraints tc
      WHERE tc.table_schema = 'public'
        AND tc.table_name = '${table}'
        AND tc.constraint_type = 'PRIMARY KEY'
      LIMIT 1;
      IF c IS NOT NULL THEN
        EXECUTE format('ALTER TABLE %I DROP CONSTRAINT %I', '${table}', c);
      END IF;
    END $$;
  `)
}

async function migrateSettingsToCompositePk(legacyWorkspaceId) {
  await addWorkspaceIdColumn('settings')
  await backfillWorkspaceId('settings', legacyWorkspaceId)
  await run(`ALTER TABLE settings ALTER COLUMN workspace_id SET NOT NULL`)
  await dropPrimaryKey('settings')
  await run(`ALTER TABLE settings ADD PRIMARY KEY (workspace_id, key)`)
  await run(`CREATE INDEX IF NOT EXISTS idx_settings_workspace_key ON settings(workspace_id, key)`)
}

async function migrateCampaignBudgetsToCompositePk(legacyWorkspaceId) {
  await addWorkspaceIdColumn('campaign_budgets')
  await backfillWorkspaceId('campaign_budgets', legacyWorkspaceId)
  await run(`ALTER TABLE campaign_budgets ALTER COLUMN workspace_id SET NOT NULL`)
  await dropPrimaryKey('campaign_budgets')
  await run(`ALTER TABLE campaign_budgets ADD PRIMARY KEY (workspace_id, account_id, campaign_id)`)
  await run(`CREATE INDEX IF NOT EXISTS idx_campaign_budgets_workspace ON campaign_budgets(workspace_id, account_id)`)
}

async function main() {
  const legacyWorkspaceId = await ensureLegacyWorkspace()
  if (!legacyWorkspaceId) throw new Error('Failed to create/find Legacy workspace')

  // Tables principales
  for (const t of ['sync_runs', 'campaigns', 'ads_raw']) {
    await addWorkspaceIdColumn(t)
    await backfillWorkspaceId(t, legacyWorkspaceId)
  }
  await run(`CREATE INDEX IF NOT EXISTS idx_sync_runs_workspace_date ON sync_runs(workspace_id, date_until)`)
  await run(`CREATE INDEX IF NOT EXISTS idx_campaigns_workspace_date ON campaigns(workspace_id, date)`)
  await run(`CREATE INDEX IF NOT EXISTS idx_ads_raw_workspace_date ON ads_raw(workspace_id, date)`)

  // Tables avec PK à adapter
  await migrateSettingsToCompositePk(legacyWorkspaceId)
  await migrateCampaignBudgetsToCompositePk(legacyWorkspaceId)

  // Membership pour tous les users existants
  await backfillWorkspaceMembers(legacyWorkspaceId)

  console.log('✓ Migration SaaS terminée. Legacy workspace_id =', legacyWorkspaceId)
}

main().catch((e) => {
  console.error('Erreur migration SaaS:', e?.message || e)
  process.exit(1)
})

