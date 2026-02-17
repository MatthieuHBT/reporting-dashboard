/**
 * Fetch spend + winners from Meta API et sauvegarde en JSON (stockage en dur, pas de BDD)
 * Usage: npm run sync (utilise META_ACCESS_TOKEN du .env)
 */
import 'dotenv/config'
import { writeFileSync, mkdirSync } from 'fs'
import { dirname, join } from 'path'
import { fileURLToPath } from 'url'
import { fetchMetaData, fetchMetaDataAllPages } from './services/metaApi.js'
import { parseCampaignName } from './utils/campaignNaming.js'
import { parseAdName } from './utils/parseAdNaming.js'
import { extractMarketFromAccount } from './utils/accountNaming.js'

const __dirname = dirname(fileURLToPath(import.meta.url))
const DATA_DIR = join(__dirname, 'data')

const token = process.env.META_ACCESS_TOKEN
if (!token) {
  console.error('Error: META_ACCESS_TOKEN env var required')
  process.exit(1)
}

// 2025-01-01 jusqu'à aujourd'hui (ou --until YYYY-MM-DD)
const untilArg = process.argv.includes('--until') ? process.argv[process.argv.indexOf('--until') + 1] : null
const since = '2025-01-01'
const until = untilArg || new Date().toISOString().slice(0, 10)
const timeRange = JSON.stringify({ since, until })

async function fetchSpend() {
  const insightsParams = {
    fields: 'spend,impressions,clicks,campaign_name,campaign_id',
    level: 'campaign',
    time_increment: 1,
    limit: 500,
    time_range: timeRange,
  }
  const data = await fetchMetaData(token, '/me/adaccounts', {
    fields: 'id,name',
    limit: 500,
  })
  const accounts = data.data || []
  const results = []

  for (const acc of accounts) {
    try {
      const insights = await fetchMetaData(token, `/${acc.id}/insights`, insightsParams)
      const campaigns = insights.data || []
      for (const c of campaigns) {
        const parsed = parseCampaignName(c.campaign_name || '')
        const { date: _namingDate, ...restParsed } = parsed
        const marketFromAccount = extractMarketFromAccount(acc.name)
        const codeCountry = parsed.codeCountry || marketFromAccount || ''
        results.push({
          accountId: acc.id,
          accountName: acc.name,
          campaignId: c.campaign_id,
          campaignName: c.campaign_name,
          date: c.date_start || c.date_stop || null, // vraie date Meta YYYY-MM-DD
          spend: parseFloat(c.spend || 0),
          impressions: parseInt(c.impressions || 0, 10),
          clicks: parseInt(c.clicks || 0, 10),
          codeCountry,
          ...restParsed,
          namingDate: _namingDate,
        })
      }
    } catch (e) {
      console.warn(`Skip account ${acc.name}:`, e.message)
    }
  }

  const byAccount = {}
  const byProduct = {}
  const byMarket = {}

  for (const r of results) {
    const accKey = r.accountName || r.accountId
    byAccount[accKey] = (byAccount[accKey] || { spend: 0, impressions: 0 })
    byAccount[accKey].spend += r.spend
    byAccount[accKey].impressions += r.impressions
    byAccount[accKey].accountName = r.accountName
    byAccount[accKey].accountId = r.accountId

    const prodKey = r.productWithAnimal || r.productName || 'Other'
    byProduct[prodKey] = (byProduct[prodKey] || { spend: 0, impressions: 0 })
    byProduct[prodKey].spend += r.spend
    byProduct[prodKey].impressions += r.impressions
    byProduct[prodKey].product = prodKey
    byProduct[prodKey].productName = r.productName
    byProduct[prodKey].animal = r.animal

    const mktKey = r.codeCountry || 'Unknown'
    byMarket[mktKey] = (byMarket[mktKey] || { spend: 0 })
    byMarket[mktKey].spend += r.spend
    byMarket[mktKey].market = mktKey
  }

  return {
    _syncedAt: new Date().toISOString(),
    _dateRange: { since, until },
    campaigns: results,
    byAccount: Object.values(byAccount),
    byProduct: Object.values(byProduct),
    byMarket: Object.values(byMarket),
    totalSpend: results.reduce((s, r) => s + r.spend, 0),
  }
}

async function fetchWinners() {
  const insightsParams = {
    fields: 'ad_name,ad_id,spend,impressions,clicks,action_values,date_start,date_stop',
    level: 'ad',
    limit: 500,
    time_increment: 1,
    time_range: timeRange,
  }
  const data = await fetchMetaData(token, '/me/adaccounts', {
    fields: 'id,name',
    limit: 500,
  })
  const accounts = data.data || []
  const allAds = []

  for (const acc of accounts) {
    try {
      const insights = await fetchMetaDataAllPages(token, `/${acc.id}/insights`, insightsParams)
      const ads = insights.data || []
      for (const a of ads) {
        const spend = parseFloat(a.spend || 0)
        let roas = null
        let purchaseValue = 0
        if (a.action_values && Array.isArray(a.action_values)) {
          const purchase = a.action_values.find(
            (av) =>
              av.action_type &&
              (av.action_type.includes('purchase') ||
                av.action_type.includes('fb_pixel_purchase') ||
                av.action_type === 'purchase')
          )
          if (purchase && purchase.value) {
            purchaseValue = parseFloat(purchase.value)
            if (spend > 0) roas = Math.round((purchaseValue / spend) * 100) / 100
          }
        }
        allAds.push({
          adName: a.ad_name || a.ad_id || '-',
          adId: a.ad_id,
          date: a.date_start || a.date_stop || null,
          spend,
          impressions: parseInt(a.impressions || 0, 10),
          clicks: parseInt(a.clicks || 0, 10),
          roas,
          purchaseValue,
        })
      }
    } catch (e) {
      console.warn(`Skip account ${acc.name} for winners:`, e.message)
    }
  }

  // Garder les raw rows (plusieurs par ad avec date) pour filtrage serveur
  return {
    _syncedAt: new Date().toISOString(),
    _dateRange: { since, until },
    adsRaw: allAds,
  }
}

async function run() {
  mkdirSync(DATA_DIR, { recursive: true })

  console.log(`Syncing data: ${since} → ${until}\n`)
  console.log('Fetching spend...')
  const spend = await fetchSpend()
  writeFileSync(join(DATA_DIR, 'spend.json'), JSON.stringify(spend, null, 2))
  console.log(`  → spend.json: ${spend.campaigns.length} campaigns, total $${spend.totalSpend.toFixed(2)}`)

  console.log('Fetching winners...')
  const winners = await fetchWinners()
  writeFileSync(join(DATA_DIR, 'winners.json'), JSON.stringify(winners, null, 2))
  console.log(`  → winners.json: ${winners.adsRaw?.length || 0} rows`)

  console.log(`\n✓ Done. Data saved to server/data/`)
}

run().catch((err) => {
  console.error(err)
  process.exit(1)
})
