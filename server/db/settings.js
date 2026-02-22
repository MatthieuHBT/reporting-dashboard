import { sql, hasDb } from './index.js'

const META_TOKEN_KEY = 'meta_access_token'

function guard() {
  if (!hasDb()) throw new Error('DATABASE_URL not configured')
}

export async function getMetaToken(workspaceId = null) {
  guard()
  if (!workspaceId) throw new Error('workspaceId required')
  const rows = await sql`SELECT value FROM settings WHERE workspace_id = ${String(workspaceId)} AND key = ${META_TOKEN_KEY} LIMIT 1`
  return rows[0]?.value?.trim() || null
}

export async function setMetaToken(workspaceId = null, token) {
  guard()
  if (!workspaceId) throw new Error('workspaceId required')
  const val = token ? String(token).trim() : null
  await sql`
    INSERT INTO settings (workspace_id, key, value, updated_at)
    VALUES (${workspaceId ? String(workspaceId) : null}, ${META_TOKEN_KEY}, ${val}, NOW())
    ON CONFLICT (workspace_id, key) DO UPDATE SET value = ${val}, updated_at = NOW()
  `
  return val
}
