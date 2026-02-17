#!/usr/bin/env node
/**
 * Seed: créer admin + team (Veluna Pets)
 * Usage: npm run db:seed
 *
 * Comptes créés:
 *   Admin: admin@velunapets.com / VpAdmin2026!
 *   Team:  team@velunapets.com  / VpTeam2026!
 */
import 'dotenv/config'
import { hashPassword } from './auth.js'
import { sql } from './index.js'

if (!process.env.DATABASE_URL) {
  console.error('DATABASE_URL required')
  process.exit(1)
}

const USERS = [
  { email: 'admin@velunapets.com', name: 'Admin', role: 'admin', password: 'VpAdmin2026!', pages: ['spend', 'stock', 'winners', 'general'] },
  { email: 'team@velunapets.com', name: 'Team', role: 'team', password: 'VpTeam2026!', pages: ['spend', 'winners', 'general'] },
]

for (const u of USERS) {
  const hash = await hashPassword(u.password)
  await sql`
    INSERT INTO users (email, password_hash, name, role)
    VALUES (${u.email}, ${hash}, ${u.name}, ${u.role})
    ON CONFLICT (email) DO UPDATE SET password_hash = ${hash}, name = ${u.name}, role = ${u.role}
  `
  const [row] = await sql`SELECT id FROM users WHERE LOWER(email) = LOWER(${u.email})`
  if (row) {
    for (const pageId of u.pages) {
      await sql`INSERT INTO user_pages (user_id, page_id) VALUES (${row.id}, ${pageId}) ON CONFLICT (user_id, page_id) DO NOTHING`
    }
  }
}

console.log('✓ Utilisateurs créés:')
console.log('   Admin: admin@velunapets.com / VpAdmin2026!')
console.log('   Team:  team@velunapets.com  / VpTeam2026!')
