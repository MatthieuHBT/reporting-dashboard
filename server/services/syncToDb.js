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
// Winners-only sync: garder petit pour éviter timeouts
const WINNERS_MAX_DAYS = 14
const CAMPAIGNS_BACKFILL_DAYS = 2

function today() {
  return new Date().toISOString().slice(0, 10)
}

/** Ajoute N jours à une date YYYY-MM-DD */
function addDays(dateStr, n) {
  const d = new Date(dateStr + 'T12:00:00')
  d.setDate(d.getDate() + n)
  return d.toISOString().slice(0, 10)
}

export async function runFullSync(accessToken, workspaceId, forceFull = false, skipAds = false, skipBudgets = false, winnersOnly = false, winnersDays = null, campaignDays = null, accountNames = null, winnersFilters = null) {
  console.log('[runFullSync] Début', { workspaceId: workspaceId || null, forceFull, skipAds, skipBudgets, winnersOnly, winnersDays, campaignDays })
  
  let since = FULL_SINCE
  let until = today()
  let incremental = false
  let alreadyUpToDate = false
  let skipCampaignsSync = false

  if (winnersOnly) {
    const requested = winnersDays ?? WINNERS_MAX_DAYS
    const days = Math.min(Math.max(1, requested), WINNERS_MAX_DAYS)
    since = addDays(until, -Math.min(days, 365))
    console.log('[runFullSync] Mode winnersOnly:', { since, until, days, requested })
  } else if (!forceFull) {
    const last = await db.getLatestSyncRun(workspaceId)
    const lastUntilVal = last?.date_until ?? last?.dateUntil
    if (lastUntilVal) {
      const lastUntil = typeof lastUntilVal === 'string' ? lastUntilVal : lastUntilVal?.toISOString?.()?.slice(0, 10)
      const nextSince = addDays(lastUntil, 1)
      if (nextSince > until) {
        alreadyUpToDate = true
        // Même "à jour", on resync les 2 derniers jours (Meta peut finaliser les chiffres avec retard)
        skipCampaignsSync = false
        const backfillStart = addDays(until, -(CAMPAIGNS_BACKFILL_DAYS - 1))
        since = backfillStart
        incremental = true
        console.log('[runFullSync] À jour (campaigns) → backfill derniers jours', { since, until })
        // Si la table campaigns est vide (ou a été vidée), on force une resync "first sync" (30j)
        try {
          const todayCount = await db.countCampaigns(until, until, workspaceId)
          if (!todayCount) {
            skipCampaignsSync = false
            since = addDays(until, -FIRST_SYNC_DAYS)
            incremental = false
            console.log('[runFullSync] campaigns vide → force resync', { since, until })
          }
        } catch (e) {
          console.warn('[runFullSync] countCampaigns failed:', e.message)
        }
      }
      if (nextSince <= until) {
        const backfillStart = addDays(until, -(CAMPAIGNS_BACKFILL_DAYS - 1))
        since = nextSince < backfillStart ? nextSince : backfillStart
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

  // Backfill ciblé (campagnes) : utile si l'historique DB est incomplet mais qu'on veut resync N jours
  if (!winnersOnly && campaignDays != null) {
    const requested = Number(campaignDays)
    const days = Math.min(Math.max(1, requested || 0), 90)
    since = addDays(until, -(days - 1))
    incremental = true
    skipCampaignsSync = false
    alreadyUpToDate = false
    console.log('[runFullSync] Mode campaignDays backfill:', { since, until, days, requested })
  }

  const timeRange = JSON.stringify({ since, until })
  const syncRun = await db.createSyncRun(since, until, 'running', workspaceId)
  console.log('[runFullSync] SyncRun créé:', syncRun.id)

  try {
    console.log('[runFullSync] Récupération ad accounts...')
    const data = await fetchMetaData(accessToken, '/me/adaccounts', {
      fields: 'id,name',
      limit: 500,
    })
    let accounts = data.data || []
    if (Array.isArray(accountNames) && accountNames.length) {
      const wanted = new Set(accountNames.map(String))
      const before = accounts.length
      accounts = accounts.filter((a) => wanted.has(String(a.name)))
      console.log('[runFullSync] Filtre ad accounts:', { before, after: accounts.length })
    }
    console.log('[runFullSync]', accounts.length, 'ad accounts trouvés')
    const results = []
    let budgetRows = []
    let adsRaw = []

    if (!winnersOnly && !skipCampaignsSync) {
    console.log('[runFullSync] Sync campaigns pour', accounts.length, 'accounts...')
    for (const acc of accounts) {
      try {
        console.log(`[runFullSync] Account ${acc.name} (${acc.id})...`)
        const insights = await fetchMetaDataAllPages(accessToken, `/${acc.id}/insights`, {
          fields: 'spend,impressions,clicks,campaign_name,campaign_id,date_start,date_stop',
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
            date: c.date_start || c.date_stop || until || null,
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
    } else if (!winnersOnly && skipCampaignsSync) {
      console.log('[runFullSync] Skip sync campaigns (déjà à jour).')
    }

    // Écrire les campagnes seulement si on les a réellement sync (sinon, on risque d'écraser avec [])
    if (!winnersOnly && !skipCampaignsSync) {
      if (incremental && results.length > 0) {
        await db.deleteCampaignsFromDate(since, workspaceId, accountNames)
        await db.insertCampaigns(syncRun.id, results, workspaceId)
      } else if (!incremental) {
        await db.replaceCampaigns(syncRun.id, results, workspaceId)
      }
    }

    // Sync budgets (campaign level)
    if (!winnersOnly && !skipBudgets) {
      console.log('[runFullSync] Sync budgets...')
      budgetRows = []
      for (const acc of accounts) {
        try {
          console.log(`[runFullSync] Budgets pour ${acc.name}...`)
          let activeCampaignIds = null
          try {
            const activeAds = await fetchMetaDataAllPages(accessToken, `/${acc.id}/ads`, {
              fields: 'id,campaign_id,effective_status',
              effective_status: JSON.stringify(['ACTIVE']),
              limit: 500,
            })
            activeCampaignIds = new Set((activeAds.data || []).map((a) => a.campaign_id).filter(Boolean))
          } catch (e) {
            console.warn(`Skip active ads check for ${acc.name}:`, e.message)
          }
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
              hasActiveAds: activeCampaignIds ? activeCampaignIds.has(c.id) : null,
            })
          }
        } catch (e) {
          console.warn(`Skip budgets for ${acc.name}:`, e.message)
        }
      }
      if (budgetRows.length > 0) await dbBudgets.upsertBudgets(workspaceId, budgetRows)
    } else if (!winnersOnly && skipBudgets) {
      console.log('[runFullSync] Skip sync budgets (option skipBudgets=1).')
    }

    // Sync ads_raw pour Winners (toujours si winnersOnly, sinon si !skipAds)
    if (winnersOnly || !skipAds) {
    console.log('[runFullSync] Sync ads_raw (winners)...')
    const { parseAdName } = await import('../utils/parseAdNaming.js')
    const insightsParams = {
      fields: 'ad_name,ad_id,spend,impressions,clicks,actions,action_values',
      level: 'ad',
      limit: 500,
      time_range: timeRange,
    }
    adsRaw = []
    const minSpend = winnersFilters?.minSpend != null ? Number(winnersFilters.minSpend) || 0 : 0
    const minRoas = winnersFilters?.minRoas != null ? Number(winnersFilters.minRoas) || 0 : 0
    const marketSet = Array.isArray(winnersFilters?.markets) && winnersFilters.markets.length
      ? new Set(winnersFilters.markets.map((m) => String(m).toUpperCase()))
      : null
    const productSet = Array.isArray(winnersFilters?.products) && winnersFilters.products.length
      ? new Set(winnersFilters.products.map((p) => String(p)))
      : null
    const normalizeProductName = (name) => String(name || '')
      .replace(/\s+PDP(\s+PDP)*\s*$/i, '')
      .replace(/\s{2,}/g, ' ')
      .trim()
    for (const acc of accounts) {
      try {
        console.log(`[runFullSync] Winners pour ${acc.name}...`)
        const insights = await fetchMetaDataAllPages(accessToken, `/${acc.id}/insights`, insightsParams)
        const ads = insights.data || []
        console.log(`[runFullSync] Account ${acc.name}: ${ads.length} ads`)
        for (const a of ads) {
          let purchaseValue = 0
          let purchaseCount = 0
          if (a.actions && Array.isArray(a.actions)) {
            const purchase = a.actions.find(
              (av) =>
                av.action_type &&
                (av.action_type.includes('purchase') ||
                  av.action_type.includes('fb_pixel_purchase') ||
                  av.action_type === 'purchase')
            )
            if (purchase?.value != null) purchaseCount = parseInt(purchase.value, 10) || 0
          }
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
          const spend = parseFloat(a.spend || 0)
          if (minSpend > 0 && spend < minSpend) continue
          const roas = spend > 0 ? (purchaseValue / spend) : null
          if (minRoas > 0 && (roas == null || roas < minRoas)) continue
          if (marketSet || productSet) {
            const parsed = parseAdName(a.ad_name || a.ad_id || '-')
            if (marketSet && !marketSet.has(String(parsed.codeCountry || '-').toUpperCase())) continue
            if (productSet && !productSet.has(normalizeProductName(parsed.productName || 'Other'))) continue
          }
          adsRaw.push({
            adId: a.ad_id,
            adName: a.ad_name || a.ad_id || '-',
            accountId: acc.id,
            accountName: acc.name,
            date: a.date_start || a.date_stop || null,
            spend,
            impressions: parseInt(a.impressions || 0, 10),
            clicks: parseInt(a.clicks || 0, 10),
            purchaseValue,
            purchaseCount,
          })
        }
      } catch (e) {
        console.warn(`Skip account ${acc.name} for winners:`, e.message)
      }
    }
    if (incremental && adsRaw.length > 0) {
      await db.deleteAdsRawFromDate(since, workspaceId)
      await db.insertAdsRaw(syncRun.id, adsRaw, workspaceId)
    } else if (!incremental) {
      await db.replaceAdsRaw(syncRun.id, adsRaw, workspaceId)
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
      alreadyUpToDate,
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
