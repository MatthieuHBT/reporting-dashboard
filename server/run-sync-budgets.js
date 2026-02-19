#!/usr/bin/env node
/**
 * Lance la synchro Meta (campagnes + budgets avec effective_status).
 * Usage: node run-sync-budgets.js
 * Nécessite .env avec DATABASE_URL et META_ACCESS_TOKEN.
 */
import 'dotenv/config'
import { runFullSync } from './services/syncToDb.js'

const token = process.env.META_ACCESS_TOKEN
if (!token) {
  console.error('META_ACCESS_TOKEN requis dans .env')
  process.exit(1)
}

const full = process.argv.includes('--full')
console.log('Lancement synchro Meta (campagnes + budgets, effective_status)' + (full ? ' [FULL]' : '') + '…')
try {
  const result = await runFullSync(token, full, true)
  console.log('OK:', result?.campaignsCount ?? 0, 'campagnes, budgets mis à jour.')
  if (result?.range) console.log('Période:', result.range.since, '→', result.range.until)
} catch (err) {
  console.error('Erreur:', err.message)
  process.exit(1)
}
