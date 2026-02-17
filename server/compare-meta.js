#!/usr/bin/env node
/**
 * Affiche les données pour comparaison avec Meta Ads Manager
 * Usage: node compare-meta.js [last_30d|last_7d|full]
 * Par défaut: last_30d
 */
import { readFileSync, existsSync } from 'fs'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const spendPath = join(__dirname, 'data', 'spend.json')

if (!existsSync(spendPath)) {
  console.error('Run npm run sync first to generate data')
  process.exit(1)
}

const spend = JSON.parse(readFileSync(spendPath, 'utf8'))
const campaigns = spend.campaigns || []
const storedRange = spend._dateRange || {}

const today = new Date().toISOString().slice(0, 10)

// Optional: node compare-meta.js full --until 2026-02-16
const untilOverride = process.argv.includes('--until') ? process.argv[process.argv.indexOf('--until') + 1] : null

function getRange(mode) {
  if (mode === 'full') {
    const until = untilOverride || storedRange.until
    return { since: storedRange.since, until }
  }
  const d = new Date()
  const pad = (n) => String(n).padStart(2, '0')
  const toStr = (date) => `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
  if (mode === 'last_7d') {
    d.setDate(d.getDate() - 6)
    return { since: toStr(d), until: today }
  }
  d.setDate(d.getDate() - 29)
  return { since: toStr(d), until: today }
}

const mode = process.argv[2] || 'last_30d'
const { since, until } = getRange(mode)

const filtered = campaigns.filter((c) => {
  const d = c.date
  if (!d || typeof d !== 'string') return false
  const dNorm = d.length >= 10 ? d : d
  return dNorm >= since && dNorm <= until
})

const byAcc = {}
const byMkt = {}
const byDate = {}
let total = 0

for (const c of filtered) {
  total += c.spend || 0
  const acc = c.accountName || c.accountId
  byAcc[acc] = (byAcc[acc] || 0) + (c.spend || 0)
  const mkt = c.codeCountry || 'Unknown'
  byMkt[mkt] = (byMkt[mkt] || 0) + (c.spend || 0)
  const dt = c.date
  if (dt) byDate[dt] = (byDate[dt] || 0) + (c.spend || 0)
}

console.log('')
console.log('╔══════════════════════════════════════════════════════════════╗')
console.log('║  DONNÉES POUR COMPARAISON META ADS MANAGER                   ║')
console.log('╚══════════════════════════════════════════════════════════════╝')
console.log('')
console.log('Période:', since, '→', until)
console.log('Données extraites du sync le:', spend._syncedAt || '-')
console.log('')
console.log('─── TOTAL SPEND ───')
console.log('  ', Math.round(total * 100) / 100, '$')
console.log('')
console.log('─── PAR COMPTE (Ad Account) ───')
Object.entries(byAcc)
  .sort((a, b) => b[1] - a[1])
  .forEach(([k, v]) => console.log('  ', k.padEnd(25), Math.round(v * 100) / 100, '$'))
console.log('')
console.log('─── PAR MARCHÉ (codeCountry) ───')
Object.entries(byMkt)
  .sort((a, b) => b[1] - a[1])
  .forEach(([k, v]) => console.log('  ', k.padEnd(10), Math.round(v * 100) / 100, '$'))
console.log('')
console.log('─── PAR JOUR (top 10) ───')
Object.entries(byDate)
  .sort((a, b) => b[1] - a[1])
  .slice(0, 10)
  .forEach(([k, v]) => console.log('  ', k, ':', Math.round(v * 100) / 100, '$'))
console.log('')
console.log('→ Compare avec Meta: Ads Manager > Insights > Même période')
console.log('')
