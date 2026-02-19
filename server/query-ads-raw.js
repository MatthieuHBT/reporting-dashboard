/**
 * Query ads_raw in DB - diagnostic
 * Usage: cd server && node query-ads-raw.js
 */
import 'dotenv/config'
import { neon } from '@neondatabase/serverless'

const sql = neon(process.env.DATABASE_URL)

async function run() {
  const total = await sql`SELECT COUNT(*) as n FROM ads_raw`
  const distinct = await sql`SELECT COUNT(DISTINCT ad_id) as n FROM ads_raw`
  const withAccount = await sql`SELECT COUNT(*) as n FROM ads_raw WHERE account_name IS NOT NULL`
  const nullAccount = await sql`SELECT COUNT(*) as n FROM ads_raw WHERE account_name IS NULL`
  const sample = await sql`SELECT ad_id, ad_name, account_name, date, spend FROM ads_raw ORDER BY spend DESC LIMIT 20`

  console.log('ads_raw:')
  console.log('  Total rows:', total[0]?.n)
  console.log('  Unique ads (ad_id):', distinct[0]?.n)
  console.log('  Rows avec account_name:', withAccount[0]?.n)
  console.log('  Rows avec account_name NULL:', nullAccount[0]?.n)
  console.log('\nTop 20 by spend:')
  sample.forEach((r, i) => console.log(`  ${i + 1}. ${r.ad_name?.slice(0, 40)} | ${r.account_name || 'NULL'} | ${r.date} | $${r.spend}`))
}

run().catch((e) => {
  console.error(e)
  process.exit(1)
})
