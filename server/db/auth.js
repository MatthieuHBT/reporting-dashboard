import bcrypt from 'bcrypt'
import { sql, hasDb } from './index.js'

function guard() {
  if (!hasDb()) throw new Error('DATABASE_URL not configured')
}

const SALT_ROUNDS = 10

export async function findUserByEmail(email) {
  guard()
  const rows = await sql`SELECT id, email, password_hash, name, role FROM users WHERE LOWER(email) = LOWER(${email}) LIMIT 1`
  return rows[0] || null
}

export async function getUserPages(userId) {
  guard()
  const rows = await sql`SELECT page_id FROM user_pages WHERE user_id = ${userId}`
  return rows.map((r) => r.page_id)
}

export async function verifyPassword(password, hash) {
  return bcrypt.compare(password, hash)
}

export async function hashPassword(password) {
  return bcrypt.hash(password, SALT_ROUNDS)
}

export async function listUsers() {
  guard()
  const rows = await sql`
    SELECT u.id, u.email, u.name, u.role, up.page_id
    FROM users u
    LEFT JOIN user_pages up ON u.id = up.user_id
    ORDER BY u.name, up.page_id
  `
  const byId = {}
  for (const r of rows) {
    if (!byId[r.id]) {
      byId[r.id] = { id: r.id, email: r.email, name: r.name, role: r.role, pages: [] }
    }
    if (r.page_id) byId[r.id].pages.push(r.page_id)
  }
  return Object.values(byId)
}

export async function updateUserPages(userId, pages) {
  guard()
  const uid = String(userId)
  await sql`DELETE FROM user_pages WHERE user_id = ${uid}`
  for (const pageId of pages) {
    await sql`INSERT INTO user_pages (user_id, page_id) VALUES (${uid}, ${String(pageId)}) ON CONFLICT (user_id, page_id) DO NOTHING`
  }
}

export async function createUser({ email, password, name, role = 'team', pages = [] }) {
  guard()
  const hash = await hashPassword(password)
  const [user] = await sql`
    INSERT INTO users (email, password_hash, name, role)
    VALUES (${email}, ${hash}, ${name}, ${role})
    RETURNING id, email, name, role
  `
  for (const pageId of pages) {
    await sql`INSERT INTO user_pages (user_id, page_id) VALUES (${user.id}, ${pageId}) ON CONFLICT (user_id, page_id) DO NOTHING`
  }
  return user
}

export async function deleteUser(userId) {
  guard()
  await sql`DELETE FROM user_pages WHERE user_id = ${userId}`
  await sql`DELETE FROM users WHERE id = ${userId}`
}
