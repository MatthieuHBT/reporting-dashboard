#!/usr/bin/env node
/**
 * Requête directe Meta API — ex: node query-meta.js BG "SMART BALL DOG"
 * Usage: node query-meta.js [market] [product]
 * Sans args: affiche le total. Avec market et/ou product: filtre.
 */
import 'dotenv/config'
import { fetchMetaData } from './services/metaApi.js'
import { parseCampaignName } from './utils/campaignNaming.js'
import { extractMarketFromAccount } from './utils/accountNaming.js'

const token = process.env.META_ACCESS_TOKEN
if (!token) {
  console.error('Error: META_ACCESS_TOKEN required in .env')
  process.exit(1)
}

const filterMarket = process.argv[2] || ''   // ex: BG
const filterProduct = process.argv[3] || ''  // ex: "SMART BALL DOG"

const since = '2025-01-01'
const until = new Date().toISOString().slice(0, 10)
const timeRange = JSON.stringify({ since, until })

function getProductKey(r) {
  return r.productWithAnimal || (r.animal ? `${(r.productName || 'Other').trim()} ${r.animal}`.trim() : (r.productName || 'Other'))
}

async function run() {
  console.log('Fetching from Meta API...')
  const data = await fetchMetaData(token, '/me/adaccounts', { fields: 'id,name', limit: 500 })
  const accounts = data.data || []
  const results = []

  for (const acc of accounts) {
    try {
      const insights = await fetchMetaData(token, `/${acc.id}/insights`, {
        fields: 'spend,impressions,clicks,campaign_name,campaign_id',
        level: 'campaign',
        time_increment: 1,
        limit: 500,
        time_range: timeRange,
      })
      const campaigns = insights.data || []
      for (const c of campaigns) {
        const parsed = parseCampaignName(c.campaign_name || '')
        const { date: _d, ...rest } = parsed
        const codeCountry = parsed.codeCountry || extractMarketFromAccount(acc.name) || ''
        results.push({
          accountName: acc.name,
          campaignName: c.campaign_name,
          date: c.date_start || c.date_stop,
          spend: parseFloat(c.spend || 0),
          codeCountry,
          ...rest,
        })
      }
    } catch (e) {
      console.warn('Skip', acc.name, ':', e.message)
    }
  }

  let filtered = results
  if (filterMarket) filtered = filtered.filter((c) => (c.codeCountry || '').toUpperCase() === filterMarket.toUpperCase())
  if (filterProduct) {
    const re = new RegExp(filterProduct.replace(/\s+/g, '[\\s_]*'), 'i')
    filtered = filtered.filter((c) => re.test(getProductKey(c)))
  }

  const total = filtered.reduce((s, r) => s + r.spend, 0)
  console.log('')
  console.log('Période:', since, '→', until)
  if (filterMarket) console.log('Market:', filterMarket)
  if (filterProduct) console.log('Product:', filterProduct)
  console.log('Spend:', Math.round(total * 100) / 100, '$')
  console.log('Rows:', filtered.length)
}

run().catch((e) => {
  console.error(e.message)
  process.exit(1)
})
