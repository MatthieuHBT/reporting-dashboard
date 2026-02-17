/**
 * Sync Meta API → Neon DB
 * Appelé par POST /api/refresh
 * Incrémentale par défaut (depuis dernière sync), full si ?full=1 ou pas de dernière sync
 */
import { fetchMetaData } from './metaApi.js'
import { parseCampaignName } from '../utils/campaignNaming.js'
import { extractMarketFromAccount } from '../utils/accountNaming.js'
import * as db from '../db/spend.js'

const FULL_SINCE = '2025-01-01'

function today() {
  return new Date().toISOString().slice(0, 10)
}

/** Ajoute N jours à une date YYYY-MM-DD */
function addDays(dateStr, n) {
  const d = new Date(dateStr + 'T12:00:00')
  d.setDate(d.getDate() + n)
  return d.toISOString().slice(0, 10)
}

export async function runFullSync(accessToken, forceFull = false) {
  let since = FULL_SINCE
  let until = today()
  let incremental = false

  if (!forceFull) {
    const last = await db.getLatestSyncRun()
    if (last?.date_until) {
      const lastUntil = typeof last.date_until === 'string' ? last.date_until : last.date_until?.toISOString?.()?.slice(0, 10)
      const nextSince = addDays(lastUntil, 1)
      if (nextSince > until) {
        return { success: true, campaignsCount: 0, syncedAt: new Date().toISOString(), incremental: false, range: { since, until }, alreadyUpToDate: true }
      }
      if (nextSince <= until) {
        since = nextSince
        incremental = true
      }
    }
  }

  const timeRange = JSON.stringify({ since, until })
  const syncRun = await db.createSyncRun(since, until, 'running')

  try {
    const data = await fetchMetaData(accessToken, '/me/adaccounts', {
      fields: 'id,name',
      limit: 500,
    })
    const accounts = data.data || []
    const results = []

    for (const acc of accounts) {
      try {
        const insights = await fetchMetaData(accessToken, `/${acc.id}/insights`, {
          fields: 'spend,impressions,clicks,campaign_name,campaign_id',
          level: 'campaign',
          time_increment: 1,
          limit: 500,
          time_range: timeRange,
        })
        const campaigns = insights.data || []
        for (const c of campaigns) {
          const parsed = parseCampaignName(c.campaign_name || '')
          const { date: _namingDate, ...restParsed } = parsed
          const marketFromAccount = extractMarketFromAccount(acc.name)
          const codeCountry = restParsed.codeCountry || marketFromAccount || ''
          results.push({
            accountId: acc.id,
            accountName: acc.name,
            campaignId: c.campaign_id,
            campaignName: c.campaign_name,
            date: c.date_start || c.date_stop || null,
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

    if (incremental && results.length > 0) {
      await db.deleteCampaignsFromDate(since)
      await db.insertCampaigns(syncRun.id, results)
    } else if (!incremental) {
      await db.replaceCampaigns(syncRun.id, results)
    }
    // incremental + 0 results : pas de suppression (Meta peut avoir retourné vide)
    await db.updateSyncRun(syncRun.id, { status: 'success', campaignsCount: results.length })
    return {
      success: true,
      campaignsCount: results.length,
      syncedAt: new Date().toISOString(),
      incremental,
      range: { since, until },
    }
  } catch (err) {
    await db.updateSyncRun(syncRun.id, {
      status: 'error',
      campaignsCount: 0,
      errorMessage: err.message,
    })
    throw err
  }
}
