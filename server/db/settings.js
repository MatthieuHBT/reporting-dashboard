import { sql, hasDb } from './index.js'

const META_TOKEN_KEY = 'meta_access_token'

function guard() {
  if (!hasDb()) throw new Error('DATABASE_URL not configured')
}

export async function getMetaToken() {
  guard()
  const rows = await sql`SELECT value FROM settings WHERE key = ${META_TOKEN_KEY} LIMIT 1`
  return rows[0]?.value?.trim() || null
}

export async function setMetaToken(token) {
  guard()
  const val = token ? String(token).trim() : null
  await sql`
    INSERT INTO settings (key, value, updated_at)
    VALUES (${META_TOKEN_KEY}, ${val}, NOW())
    ON CONFLICT (key) DO UPDATE SET value = ${val}, updated_at = NOW()
  `
  return val
}
