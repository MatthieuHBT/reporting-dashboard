/**
 * Simule /api/reports/winners pour vérifier le nombre retourné
 * Usage: cd server && node query-winners-api.js
 */
import 'dotenv/config'
import { neon } from '@neondatabase/serverless'

const sql = neon(process.env.DATABASE_URL)

async function run() {
  // Même logique que l'API : full range
  const since = '2025-01-01'
  const until = new Date().toISOString().slice(0, 10)

  // Sans filtre account
  const rows = await sql`
    SELECT * FROM ads_raw 
    WHERE date >= ${since} AND date <= ${until}
  `

  // Compte par account_name
  const byAccount = await sql`
    SELECT account_name, COUNT(*) as n, COUNT(DISTINCT ad_id) as u
    FROM ads_raw WHERE date >= ${since} AND date <= ${until}
    GROUP BY account_name ORDER BY n DESC
  `
  console.log('Par account_name:')
  byAccount.forEach((r) => console.log(`  ${r.account_name || 'NULL'}: ${r.n} rows, ${r.u} unique ads`))
  console.log('')

  const byAd = {}
  for (const r of rows) {
    const key = r.ad_id || r.ad_name
    if (!byAd[key]) {
      byAd[key] = { adName: r.ad_name, adId: r.ad_id, spend: 0, impressions: 0, clicks: 0, purchaseValue: 0 }
    }
    byAd[key].spend += parseFloat(r.spend || 0)
    byAd[key].impressions += parseInt(r.impressions || 0, 10)
    byAd[key].clicks += parseInt(r.clicks || 0, 10)
    byAd[key].purchaseValue += parseFloat(r.purchase_value || 0)
  }

  const aggregated = Object.values(byAd).sort((a, b) => b.spend - a.spend)

  console.log('Simulation API /reports/winners (datePreset=full, no account filter):')
  console.log('  Rows ads_raw dans la plage:', rows.length)
  console.log('  Winners agrégés (unique ads):', aggregated.length)
  console.log('\nTop 15 par spend:')
  aggregated.slice(0, 15).forEach((a, i) =>
    console.log(`  ${i + 1}. ${a.adName?.slice(0, 45)} | $${a.spend?.toFixed(2)}`)
  )
}

run().catch((e) => {
  console.error(e)
  process.exit(1)
})
