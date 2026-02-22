import { sql, hasDb } from './index.js'

const META_TOKEN_KEY = 'meta_access_token'

function guard() {
  if (!hasDb()) throw new Error('DATABASE_URL not configured')
}

export async function getMetaToken(workspaceId = null) {
  guard()
  if (!workspaceId) throw new Error('workspaceId required')
  const wid = String(workspaceId)
  try {
    const rows = await sql`SELECT value FROM settings WHERE workspace_id = ${wid} AND key = ${META_TOKEN_KEY} LIMIT 1`
    return rows[0]?.value?.trim() || null
  } catch (e) {
    // Rétro-compat: ancienne table settings sans workspace_id
    const rows = await sql`SELECT value FROM settings WHERE key = ${META_TOKEN_KEY} LIMIT 1`
    return rows[0]?.value?.trim() || null
  }
}

export async function setMetaToken(workspaceId = null, token) {
  guard()
  if (!workspaceId) throw new Error('workspaceId required')
  const val = token ? String(token).trim() : null
  const wid = String(workspaceId)
  // Pas d'ON CONFLICT ici: certains environnements ont encore la PK sur (key) ou pas de contrainte UNIQUE (workspace_id, key).
  // Stratégie robuste: DELETE puis INSERT (workspace-scoped si possible, sinon legacy par key).
  try {
    await sql`DELETE FROM settings WHERE workspace_id = ${wid} AND key = ${META_TOKEN_KEY}`
  } catch (_) {
    await sql`DELETE FROM settings WHERE key = ${META_TOKEN_KEY}`
  }
  try {
    await sql`
      INSERT INTO settings (workspace_id, key, value, updated_at)
      VALUES (${wid}, ${META_TOKEN_KEY}, ${val}, NOW())
    `
  } catch (_) {
    // Rétro-compat: ancienne table settings sans workspace_id
    await sql`
      INSERT INTO settings (key, value, updated_at)
      VALUES (${META_TOKEN_KEY}, ${val}, NOW())
    `
  }
  return val
}
