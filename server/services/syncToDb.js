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
import * as dbBudgets from '../db/budgets.js'

const FULL_SINCE = '2025-01-01'
const FIRST_SYNC_DAYS = 30
const WINNERS_MAX_DAYS = 60

function today() {
  return new Date().toISOString().slice(0, 10)
}

/** Ajoute N jours à une date YYYY-MM-DD */
function addDays(dateStr, n) {
  const d = new Date(dateStr + 'T12:00:00')
  d.setDate(d.getDate() + n)
  return d.toISOString().slice(0, 10)
}

export async function runFullSync(accessToken, forceFull = false, skipAds = false, winnersOnly = false, winnersDays = null) {
  console.log('[runFullSync] Début', { forceFull, skipAds, winnersOnly, winnersDays })
  
  let since = FULL_SINCE
  let until = today()
  let incremental = false

  if (winnersOnly) {
    const days = winnersDays ?? WINNERS_MAX_DAYS
    since = addDays(until, -Math.min(days, 365))
    console.log('[runFullSync] Mode winnersOnly:', { since, until, days })
  } else if (!forceFull) {
    const last = await db.getLatestSyncRun()
    const lastUntilVal = last?.date_until ?? last?.dateUntil
    if (lastUntilVal) {
      const lastUntil = typeof lastUntilVal === 'string' ? lastUntilVal : lastUntilVal?.toISOString?.()?.slice(0, 10)
      const nextSince = addDays(lastUntil, 1)
      if (nextSince > until) {
        console.log('[runFullSync] Déjà à jour')
        return { success: true, campaignsCount: 0, syncedAt: new Date().toISOString(), incremental: false, range: { since, until }, alreadyUpToDate: true }
      }
      if (nextSince <= until) {
        since = nextSince
        incremental = true
        console.log('[runFullSync] Mode incrémental:', { since, until })
      }
    } else {
      // Première sync (base vide) : limite à 30j pour éviter timeout
      since = addDays(until, -FIRST_SYNC_DAYS)
      console.log('[runFullSync] Première sync (limite 30j):', { since, until })
    }
  } else {
    console.log('[runFullSync] Mode full:', { since, until })
  }

  const timeRange = JSON.stringify({ since, until })
  const syncRun = await db.createSyncRun(since, until, 'running')
  console.log('[runFullSync] SyncRun créé:', syncRun.id)

  try {
    console.log('[runFullSync] Récupération ad accounts...')
    const data = await fetchMetaData(accessToken, '/me/adaccounts', {
      fields: 'id,name',
      limit: 500,
    })
    const accounts = data.data || []
    console.log('[runFullSync]', accounts.length, 'ad accounts trouvés')
    const results = []
    let budgetRows = []
    let adsRaw = []

    if (!winnersOnly) {
    console.log('[runFullSync] Sync campaigns pour', accounts.length, 'accounts...')
    for (const acc of accounts) {
      try {
        console.log(`[runFullSync] Account ${acc.name} (${acc.id})...`)
        const insights = await fetchMetaData(accessToken, `/${acc.id}/insights`, {
          fields: 'spend,impressions,clicks,campaign_name,campaign_id',
          level: 'campaign',
          time_increment: 1,
          limit: 500,
          time_range: timeRange,
        })
        const campaigns = insights.data || []
        console.log(`[runFullSync] Account ${acc.name}: ${campaigns.length} campagnes`)
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

    // Sync budgets (campaign level)
    if (!winnersOnly) {
      console.log('[runFullSync] Sync budgets...')
      budgetRows = []
      for (const acc of accounts) {
        try {
          console.log(`[runFullSync] Budgets pour ${acc.name}...`)
          const campData = await fetchMetaDataAllPages(accessToken, `/${acc.id}/campaigns`, {
            fields: 'id,name,daily_budget,lifetime_budget,effective_status',
            limit: 500,
          })
          console.log(`[runFullSync] Account ${acc.name}: ${campData.data?.length || 0} campagnes avec budgets`)
          for (const c of campData.data || []) {
            const dailyRaw = c.daily_budget ? parseFloat(c.daily_budget) / 100 : 0
            const lifetimeRaw = c.lifetime_budget ? parseFloat(c.lifetime_budget) / 100 : 0
            budgetRows.push({
              accountId: acc.id,
              accountName: acc.name,
              campaignId: c.id,
              campaignName: c.name || c.id,
              dailyBudget: dailyRaw,
              lifetimeBudget: lifetimeRaw,
              effectiveStatus: c.effective_status || null,
            })
          }
        } catch (e) {
          console.warn(`Skip budgets for ${acc.name}:`, e.message)
        }
      }
      if (budgetRows.length > 0) await dbBudgets.upsertBudgets(budgetRows)
    }

    // Sync ads_raw pour Winners (toujours si winnersOnly, sinon si !skipAds)
    if (winnersOnly || !skipAds) {
    console.log('[runFullSync] Sync ads_raw (winners)...')
    const insightsParams = {
      fields: 'ad_name,ad_id,spend,impressions,clicks,action_values',
      level: 'ad',
      limit: 500,
      time_increment: 1,
      time_range: timeRange,
    }
    adsRaw = []
    for (const acc of accounts) {
      try {
        console.log(`[runFullSync] Winners pour ${acc.name}...`)
        const insights = await fetchMetaDataAllPages(accessToken, `/${acc.id}/insights`, insightsParams)
        const ads = insights.data || []
        console.log(`[runFullSync] Account ${acc.name}: ${ads.length} ads`)
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
    const budgetsCount = winnersOnly ? 0 : budgetRows.length
    const adsCount = adsRaw.length
    
    console.log('[runFullSync] Résultats:', { campaignsCount, budgetsCount, adsCount })
    
    await db.updateSyncRun(syncRun.id, { status: 'success', campaignsCount })
    console.log('[runFullSync] Sync terminée avec succès')
    
    return {
      success: true,
      campaignsCount,
      budgetsCount,
      adsCount,
      winnersOnly,
      syncedAt: new Date().toISOString(),
      incremental,
      range: { since, until },
    }
  } catch (err) {
    console.error('[runFullSync] ERREUR:', {
      message: err.message,
      status: err?.status,
      code: err?.code,
      stack: err?.stack?.split('\n').slice(0, 10).join('\n'),
    })
    await db.updateSyncRun(syncRun.id, {
      status: 'error',
      campaignsCount: 0,
      errorMessage: err.message,
    })
    throw err
  }
}
