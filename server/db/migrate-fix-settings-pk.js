#!/usr/bin/env node
/**
 * Fix: settings doit avoir une PK (workspace_id, key) pour le mode SaaS.
 * À lancer si setMetaToken ou getMetaToken échouent (ON CONFLICT / requêtes par workspace).
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

  await run(`ALTER TABLE settings ADD COLUMN IF NOT EXISTS workspace_id UUID`)

  let legacyId = await getFirstWorkspaceId()
  if (!legacyId) {
    const inserted = await sql`INSERT INTO workspaces (name) VALUES ('Legacy') RETURNING id`
    legacyId = inserted?.[0]?.id
  }
  if (!legacyId) throw new Error('Could not get or create workspace')

  await run(`UPDATE settings SET workspace_id = '${legacyId}'::uuid WHERE workspace_id IS NULL`)
  await run(`ALTER TABLE settings ALTER COLUMN workspace_id SET NOT NULL`).catch(() => {})

  await run(`
    DO $$
    DECLARE c TEXT;
    BEGIN
      SELECT tc.constraint_name INTO c
      FROM information_schema.table_constraints tc
      WHERE tc.table_schema = 'public' AND tc.table_name = 'settings' AND tc.constraint_type = 'PRIMARY KEY'
      LIMIT 1;
      IF c IS NOT NULL THEN
        EXECUTE format('ALTER TABLE settings DROP CONSTRAINT %I', c);
      END IF;
    END $$;
  `)
  await run(`ALTER TABLE settings ADD PRIMARY KEY (workspace_id, key)`).catch((e) => {
    if (e.code === '42P16' || e.message?.includes('already exists')) return
    throw e
  })
  await run(`CREATE INDEX IF NOT EXISTS idx_settings_workspace_key ON settings(workspace_id, key)`)

  console.log('✓ settings: PK (workspace_id, key) OK')
}

main().catch((e) => {
  console.error('Erreur:', e?.message || e)
  process.exit(1)
})
