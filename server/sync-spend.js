/**
 * Sync spend from Meta API - run directly from CLI
 * Usage: META_ACCESS_TOKEN=xxx node sync-spend.js [datePreset]
 *        META_ACCESS_TOKEN=xxx node sync-spend.js --since 2025-02-01 --until 2025-02-15
 *
 * datePreset: last_7d | last_14d | last_30d | today | yesterday (default: last_7d)
 */
import 'dotenv/config'
import { fetchMetaData } from './services/metaApi.js'
import { parseCampaignName } from './utils/campaignNaming.js'

const token = process.env.META_ACCESS_TOKEN
if (!token) {
  console.error('Error: META_ACCESS_TOKEN env var required')
  process.exit(1)
}

const args = process.argv.slice(2)
let datePreset = 'last_7d'
let since, until
for (let i = 0; i < args.length; i++) {
  if (args[i] === '--since') since = args[++i]
  else if (args[i] === '--until') until = args[++i]
  else if (!args[i].startsWith('--')) datePreset = args[i]
}

const useCustomRange = since && until
const insightsParams = {
  fields: 'spend,impressions,clicks,campaign_name,campaign_id',
  level: 'campaign',
  time_increment: 1,
  limit: 500
}
if (useCustomRange) {
  insightsParams.time_range = JSON.stringify({ since, until })
} else {
  insightsParams.date_preset = datePreset
}

async function run() {
  const data = await fetchMetaData(token, '/me/adaccounts', {
    fields: 'id,name',
    limit: 500
  })
  const accounts = data.data || []
  const results = []

  for (const acc of accounts) {
    try {
      const insights = await fetchMetaData(token, `/${acc.id}/insights`, insightsParams)
      const campaigns = insights.data || []
      for (const c of campaigns) {
        const parsed = parseCampaignName(c.campaign_name || '')
        results.push({
          accountId: acc.id,
          accountName: acc.name,
          campaignId: c.campaign_id,
          campaignName: c.campaign_name,
          date: c.date_start || c.date_stop || null,
          spend: parseFloat(c.spend || 0),
          impressions: parseInt(c.impressions || 0, 10),
          clicks: parseInt(c.clicks || 0, 10),
          ...parsed
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

    const prodKey = r.productName || 'Other'
    byProduct[prodKey] = (byProduct[prodKey] || { spend: 0, impressions: 0 })
    byProduct[prodKey].spend += r.spend
    byProduct[prodKey].impressions += r.impressions
    byProduct[prodKey].product = prodKey

    const mktKey = r.codeCountry || 'Unknown'
    byMarket[mktKey] = (byMarket[mktKey] || { spend: 0 })
    byMarket[mktKey].spend += r.spend
    byMarket[mktKey].market = mktKey
  }

  const output = {
    campaigns: results,
    byAccount: Object.values(byAccount),
    byProduct: Object.values(byProduct),
    byMarket: Object.values(byMarket),
    totalSpend: results.reduce((s, r) => s + r.spend, 0)
  }

  console.log(JSON.stringify(output, null, 2))
  console.error(`\nSync OK: ${results.length} campaigns, total spend $${output.totalSpend.toFixed(2)}`)
}

run().catch((err) => {
  console.error(err)
  process.exit(1)
})
