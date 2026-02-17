#!/usr/bin/env node
/**
 * Génère un rapport client (CSV + résumé) pour vérification avec Meta
 * Usage: node report-clients.js [last_30d|last_7d|full]
 * Fichiers créés: server/data/reports/
 */
import { readFileSync, existsSync, mkdirSync, writeFileSync } from 'fs'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const DATA_DIR = join(__dirname, 'data')
const REPORTS_DIR = join(DATA_DIR, 'reports')
const spendPath = join(DATA_DIR, 'spend.json')

if (!existsSync(spendPath)) {
  console.error('Run npm run sync first to generate data')
  process.exit(1)
}

const spend = JSON.parse(readFileSync(spendPath, 'utf8'))
const campaigns = spend.campaigns || []
const storedRange = spend._dateRange || {}

const today = new Date().toISOString().slice(0, 10)

// Optional: node report-clients.js full --until 2026-02-16
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
  return d >= since && d <= until
})

const byAcc = {}
const byMkt = {}
const byProduct = {}
const byDate = {}
let total = 0

for (const c of filtered) {
  total += c.spend || 0
  const acc = c.accountName || c.accountId
  byAcc[acc] = (byAcc[acc] || 0) + (c.spend || 0)
  const mkt = c.codeCountry || 'Unknown'
  byMkt[mkt] = (byMkt[mkt] || 0) + (c.spend || 0)
  const prod = c.productName || 'Other'
  byProduct[prod] = (byProduct[prod] || 0) + (c.spend || 0)
  const dt = c.date
  if (dt) byDate[dt] = (byDate[dt] || 0) + (c.spend || 0)
}

const totalRounded = Math.round(total * 100) / 100
const syncDate = spend._syncedAt ? new Date(spend._syncedAt).toLocaleString('fr-FR') : '-'

mkdirSync(REPORTS_DIR, { recursive: true })

// 1. CSV Spend par compte
const csvAccounts = [
  'Account,Spend ($),%',
  ...Object.entries(byAcc)
    .sort((a, b) => b[1] - a[1])
    .map(([acc, v]) => {
      const val = Math.round(v * 100) / 100
      const pct = total > 0 ? Math.round((v / total) * 1000) / 10 : 0
      return `"${acc}",${val},${pct}%`
    }),
  `"TOTAL",${totalRounded},100%`,
].join('\n')

const csvAccountsPath = join(REPORTS_DIR, `report_spend_by_account_${since}_${until}.csv`)
writeFileSync(csvAccountsPath, '\uFEFF' + csvAccounts, 'utf8')

// 2. CSV Spend par marché
const csvMarkets = [
  'Market,Spend ($),%',
  ...Object.entries(byMkt)
    .sort((a, b) => b[1] - a[1])
    .map(([mkt, v]) => {
      const val = Math.round(v * 100) / 100
      const pct = total > 0 ? Math.round((v / total) * 1000) / 10 : 0
      return `"${mkt}",${val},${pct}%`
    }),
  `"TOTAL",${totalRounded},100%`,
].join('\n')

const csvMarketsPath = join(REPORTS_DIR, `report_spend_by_market_${since}_${until}.csv`)
writeFileSync(csvMarketsPath, '\uFEFF' + csvMarkets, 'utf8')

// 3. CSV Spend par jour
const csvDaily = [
  'Date,Spend ($)',
  ...Object.entries(byDate)
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([dt, v]) => `${dt},${Math.round(v * 100) / 100}`),
  `TOTAL,${totalRounded}`,
].join('\n')

const csvDailyPath = join(REPORTS_DIR, `report_spend_daily_${since}_${until}.csv`)
writeFileSync(csvDailyPath, '\uFEFF' + csvDaily, 'utf8')

// 4. Résumé texte pour envoi client
const summary = `
═══════════════════════════════════════════════════════════════
  RAPPORT SPEND META ADS — VÉRIFICATION
  Veluna Pets / Advertising Report
═══════════════════════════════════════════════════════════════

Période : ${since} → ${until}
Généré le : ${new Date().toLocaleString('fr-FR')}
Source : Meta Marketing API (sync ${syncDate})

───────────────────────────────────────────────────────────────
RÉSUMÉ
───────────────────────────────────────────────────────────────

Total Spend : ${totalRounded.toLocaleString('fr-FR')} $

Par compte (top 10) :
${Object.entries(byAcc)
  .sort((a, b) => b[1] - a[1])
  .slice(0, 10)
  .map(([k, v], i) => `  ${i + 1}. ${k} : ${(Math.round(v * 100) / 100).toLocaleString('fr-FR')} $`)
  .join('\n')}

Par marché :
${Object.entries(byMkt)
  .sort((a, b) => b[1] - a[1])
  .map(([k, v]) => `  ${k} : ${(Math.round(v * 100) / 100).toLocaleString('fr-FR')} $`)
  .join('\n')}

───────────────────────────────────────────────────────────────
DASHBOARD — 4 REPORTINGS DISPONIBLES
───────────────────────────────────────────────────────────────

✓ Finance    — Spend & Budget par ad account, produit, marché
✓ Stock      — Alertes stock, SKU par warehouse
✓ Winners    — Top ads par spend / ROAS, par marché et produit
✓ General    — Vue globale, recommandations (à venir)

───────────────────────────────────────────────────────────────
VÉRIFICATION META ADS MANAGER
───────────────────────────────────────────────────────────────

1. Ouvrir Meta Ads Manager > Insights
2. Sélectionner la même période : ${since} à ${until}
3. Comparer le Total Spend et le breakdown par compte
4. Les chiffres peuvent différer légèrement selon l'heure de sync

═══════════════════════════════════════════════════════════════
`.trim()

const summaryPath = join(REPORTS_DIR, `report_resume_${since}_${until}.txt`)
writeFileSync(summaryPath, summary, 'utf8')

console.log('')
console.log('✓ Rapport client généré dans server/data/reports/')
console.log('')
console.log('Fichiers créés :')
console.log('  •', summaryPath.split('/').pop())
console.log('  •', csvAccountsPath.split('/').pop())
console.log('  •', csvMarketsPath.split('/').pop())
console.log('  •', csvDailyPath.split('/').pop())
console.log('')
console.log('→ Partage ces fichiers à tes clients pour qu\'ils comparent avec Meta Ads Manager')
console.log('')
