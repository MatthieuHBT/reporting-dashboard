/**
 * Sync Meta API → Neon DB
 * Appelé par POST /api/refresh
 * Incrémentale par défaut (depuis dernière sync), full si ?full=1 ou pas de dernière sync
 * Sync campaigns (spend) + ads_raw (winners)
 */
import { fetchMetaData, fetchMetaDataAllPages } from './metaApi.js'
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

export async function runFullSync(accessToken, forceFull = false, skipAds = false, winnersOnly = false) {
  let since = FULL_SINCE
  let until = today()
  let incremental = false

  if (!forceFull && !winnersOnly) {
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

    if (!winnersOnly) {
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
    }

    if (!winnersOnly && incremental && results.length > 0) {
      await db.deleteCampaignsFromDate(since)
      await db.insertCampaigns(syncRun.id, results)
    } else if (!winnersOnly && !incremental) {
      await db.replaceCampaigns(syncRun.id, results)
    }

    // Sync ads_raw pour Winners (toujours si winnersOnly, sinon si !skipAds)
    if (winnersOnly || !skipAds) {
    const insightsParams = {
      fields: 'ad_name,ad_id,spend,impressions,clicks,action_values',
      level: 'ad',
      limit: 500,
      time_increment: 1,
      time_range: timeRange,
    }
    const adsRaw = []
    for (const acc of accounts) {
      try {
        const insights = await fetchMetaDataAllPages(accessToken, `/${acc.id}/insights`, insightsParams)
        const ads = insights.data || []
        for (const a of ads) {
          let purchaseValue = 0
          if (a.action_values && Array.isArray(a.action_values)) {
            const purchase = a.action_values.find(
              (av) =>
                av.action_type &&
                (av.action_type.includes('purchase') ||
                  av.action_type.includes('fb_pixel_purchase') ||
                  av.action_type === 'purchase')
            )
            if (purchase?.value) purchaseValue = parseFloat(purchase.value)
          }
          adsRaw.push({
            adId: a.ad_id,
            adName: a.ad_name || a.ad_id || '-',
            accountId: acc.id,
            accountName: acc.name,
            date: a.date_start || a.date_stop || null,
            spend: parseFloat(a.spend || 0),
            impressions: parseInt(a.impressions || 0, 10),
            clicks: parseInt(a.clicks || 0, 10),
            purchaseValue,
          })
        }
      } catch (e) {
        console.warn(`Skip account ${acc.name} for winners:`, e.message)
      }
    }
    if (incremental && adsRaw.length > 0) {
      await db.deleteAdsRawFromDate(since)
      await db.insertAdsRaw(syncRun.id, adsRaw)
    } else if (!incremental) {
      await db.replaceAdsRaw(syncRun.id, adsRaw)
    }
    }

    const campaignsCount = winnersOnly ? 0 : results.length
    await db.updateSyncRun(syncRun.id, { status: 'success', campaignsCount })
    return {
      success: true,
      campaignsCount,
      winnersOnly,
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
