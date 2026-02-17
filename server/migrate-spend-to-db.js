/**
 * Migre spend.json → Neon DB (table campaigns)
 * Usage: cd server && node migrate-spend-to-db.js
 * Nécessite DATABASE_URL dans .env
 */
import 'dotenv/config'
import { readFileSync } from 'fs'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'
import * as db from './db/spend.js'

const __dirname = dirname(fileURLToPath(import.meta.url))
const SPEND_PATH = join(__dirname, 'data', 'spend.json')

async function run() {
  if (!process.env.DATABASE_URL) {
    console.error('Erreur: DATABASE_URL manquante dans .env')
    process.exit(1)
  }

  let raw
  try {
    raw = readFileSync(SPEND_PATH, 'utf-8')
  } catch (e) {
    console.error('Erreur: impossible de lire spend.json:', e.message)
    process.exit(1)
  }

  const spend = JSON.parse(raw)
  const campaigns = spend.campaigns || []
  if (!campaigns.length) {
    console.error('Erreur: spend.json ne contient aucune campagne')
    process.exit(1)
  }

  const { _dateRange } = spend
  const since = _dateRange?.since || '2025-01-01'
  const until = _dateRange?.until || new Date().toISOString().slice(0, 10)

  const syncRun = await db.createSyncRun(since, until, 'running')
  console.log(`Sync run créé: ${syncRun.id}`)

  await db.replaceCampaigns(syncRun.id, campaigns)
  await db.updateSyncRun(syncRun.id, { status: 'success', campaignsCount: campaigns.length })

  const totalSpend = campaigns.reduce((s, c) => s + (c.spend || 0), 0)
  console.log(`✓ Migration OK: ${campaigns.length} campagnes, total spend $${totalSpend.toFixed(2)}`)
}

run().catch((err) => {
  console.error(err)
  process.exit(1)
})
