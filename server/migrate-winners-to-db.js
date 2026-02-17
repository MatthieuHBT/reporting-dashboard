/**
 * Migre winners.json → Neon DB (table ads_raw)
 * Usage: cd server && node migrate-winners-to-db.js
 * Nécessite DATABASE_URL dans .env
 */
import 'dotenv/config'
import { readFileSync, existsSync } from 'fs'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'
import * as db from './db/spend.js'

const __dirname = dirname(fileURLToPath(import.meta.url))
const WINNERS_PATH = join(__dirname, 'data', 'winners.json')

async function run() {
  if (!process.env.DATABASE_URL) {
    console.error('Erreur: DATABASE_URL manquante dans .env')
    process.exit(1)
  }
  if (!existsSync(WINNERS_PATH)) {
    console.error('Erreur: winners.json introuvable. Lance "npm run sync" d\'abord.')
    process.exit(1)
  }

  const raw = JSON.parse(readFileSync(WINNERS_PATH, 'utf-8'))
  const adsRaw = raw.adsRaw || []
  if (!adsRaw.length) {
    console.error('Erreur: winners.json ne contient aucun ad')
    process.exit(1)
  }

  const { _dateRange } = raw
  const since = _dateRange?.since || '2025-01-01'
  const until = _dateRange?.until || new Date().toISOString().slice(0, 10)

  const syncRun = await db.createSyncRun(since, until, 'running')
  const rows = adsRaw.map((a) => ({
    adId: a.adId,
    adName: a.adName,
    accountId: a.accountId || null,
    accountName: a.accountName || null,
    date: a.date || null,
    spend: a.spend || 0,
    impressions: a.impressions || 0,
    clicks: a.clicks || 0,
    purchaseValue: a.purchaseValue || 0,
  }))
  await db.replaceAdsRaw(syncRun.id, rows)
  await db.updateSyncRun(syncRun.id, { status: 'success', campaignsCount: 0 })

  const totalSpend = rows.reduce((s, r) => s + (r.spend || 0), 0)
  console.log(`✓ Migration winners OK: ${rows.length} ads, total spend $${totalSpend.toFixed(2)}`)
}

run().catch((err) => {
  console.error(err)
  process.exit(1)
})
