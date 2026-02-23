import { sql, hasDb } from './index.js'
import { extractMarketFromAccount } from '../utils/accountNaming.js'

function guard() {
  if (!hasDb()) throw new Error('DATABASE_URL not configured')
}

export async function getSyncRuns(limit = 5, workspaceId = null) {
  guard()
  if (!workspaceId) {
    return sql`
      SELECT id, synced_at, date_since, date_until, status, campaigns_count, error_message
      FROM sync_runs ORDER BY synced_at DESC LIMIT ${limit}
    `
  }
  return sql`
    SELECT id, synced_at, date_since, date_until, status, campaigns_count, error_message
    FROM sync_runs
    WHERE workspace_id = ${String(workspaceId)}
    ORDER BY synced_at DESC LIMIT ${limit}
  `
}

export async function getLatestSyncRun(workspaceId = null) {
  guard()
  const rows = workspaceId
    ? await sql`
      SELECT id, synced_at, date_since, date_until, campaigns_count
      FROM sync_runs
      WHERE status = 'success' AND workspace_id = ${String(workspaceId)}
      ORDER BY synced_at DESC LIMIT 1
    `
    : await sql`
      SELECT id, synced_at, date_since, date_until, campaigns_count
      FROM sync_runs WHERE status = 'success'
      ORDER BY synced_at DESC LIMIT 1
    `
  return rows[0] || null
}

/** True if this workspace has at least one successful sync (for onboarding "first sync done"). */
export async function hasSuccessfulSync(workspaceId) {
  guard()
  if (!workspaceId) return false
  const rows = await sql`
    SELECT 1 FROM sync_runs
    WHERE workspace_id = ${String(workspaceId)} AND status = 'success'
    LIMIT 1
  `
  return (rows?.length ?? 0) > 0
}

export async function countCampaigns(since = null, until = null, workspaceId = null) {
  guard()
  let rows
  if (since && until) {
    rows = workspaceId
      ? await sql`SELECT COUNT(*)::int AS count FROM campaigns WHERE workspace_id = ${String(workspaceId)} AND date >= ${since} AND date <= ${until}`
      : await sql`SELECT COUNT(*)::int AS count FROM campaigns WHERE date >= ${since} AND date <= ${until}`
  } else {
    rows = workspaceId
      ? await sql`SELECT COUNT(*)::int AS count FROM campaigns WHERE workspace_id = ${String(workspaceId)}`
      : await sql`SELECT COUNT(*)::int AS count FROM campaigns`
  }
  return rows?.[0]?.count ?? 0
}

/** Clause WHERE workspace : workspace_id = wid OU legacy (workspace_id IS NULL) avec account dans listes autorisées */
function workspaceWhere(wid, allowedAccountIds = [], allowedAccountNames = []) {
  const ids = Array.isArray(allowedAccountIds) ? allowedAccountIds.filter(Boolean).map(String) : []
  const names = Array.isArray(allowedAccountNames) ? allowedAccountNames.filter(Boolean).map(String) : []
  const includeLegacy = ids.length > 0 || names.length > 0
  if (!includeLegacy) return sql`workspace_id = ${wid}`
  if (ids.length && names.length) return sql`(workspace_id = ${wid} OR (workspace_id IS NULL AND (account_id = ANY(${ids}) OR account_name = ANY(${names}))))`
  if (ids.length) return sql`(workspace_id = ${wid} OR (workspace_id IS NULL AND account_id = ANY(${ids})))`
  return sql`(workspace_id = ${wid} OR (workspace_id IS NULL AND account_name = ANY(${names})))`
}

export async function getCampaigns(since, until, accountName = null, workspaceId = null, opts = {}) {
  guard()
  const wid = typeof workspaceId === 'string' && workspaceId.trim() ? workspaceId.trim() : null
  if (!wid) return []
  const allowedIds = opts.allowedAccountIds ?? []
  const allowedNames = opts.allowedAccountNames ?? []
  const wsWhere = workspaceWhere(wid, allowedIds, allowedNames)

  const raw = typeof accountName === 'string' ? accountName.trim() : ''
  const market = raw && /^[A-Za-z]{2,3}$/.test(raw) ? raw.toUpperCase() : null
  const namePattern = market ? `^(CBO|ABO)_${market}_` : null

  let rows
  if (since && until && namePattern) {
    rows = await sql`
      SELECT *
      FROM (
        SELECT DISTINCT ON (account_id, campaign_id, date) *
        FROM campaigns
        WHERE ${wsWhere}
          AND date >= ${since} AND date <= ${until}
          AND campaign_name ~* ${namePattern}
        ORDER BY account_id, campaign_id, date, created_at DESC
      ) t
      ORDER BY campaign_name, date DESC, spend DESC
    `
  } else if (namePattern) {
    rows = await sql`
      SELECT *
      FROM (
        SELECT DISTINCT ON (account_id, campaign_id, date) *
        FROM campaigns
        WHERE ${wsWhere}
          AND campaign_name ~* ${namePattern}
        ORDER BY account_id, campaign_id, date, created_at DESC
      ) t
      ORDER BY campaign_name, date DESC, spend DESC
    `
  } else if (since && until && accountName) {
    rows = await sql`
      SELECT *
      FROM (
        SELECT DISTINCT ON (account_id, campaign_id, date) *
        FROM campaigns
        WHERE ${wsWhere}
          AND date >= ${since} AND date <= ${until}
          AND account_name = ${accountName}
        ORDER BY account_id, campaign_id, date, created_at DESC
      ) t
      ORDER BY campaign_name, date DESC, spend DESC
    `
  } else if (accountName) {
    rows = await sql`
      SELECT *
      FROM (
        SELECT DISTINCT ON (account_id, campaign_id, date) *
        FROM campaigns
        WHERE ${wsWhere}
          AND account_name = ${accountName}
        ORDER BY account_id, campaign_id, date, created_at DESC
      ) t
      ORDER BY campaign_name, date DESC, spend DESC
    `
  } else if (since && until) {
    rows = await sql`
      SELECT *
      FROM (
        SELECT DISTINCT ON (account_id, campaign_id, date) *
        FROM campaigns
        WHERE ${wsWhere}
          AND date >= ${since} AND date <= ${until}
        ORDER BY account_id, campaign_id, date, created_at DESC
      ) t
      ORDER BY campaign_name, date DESC, spend DESC
    `
  } else {
    rows = await sql`
      SELECT *
      FROM (
        SELECT DISTINCT ON (account_id, campaign_id, date) *
        FROM campaigns
        WHERE ${wsWhere}
        ORDER BY account_id, campaign_id, date, created_at DESC
      ) t
      ORDER BY campaign_name, date DESC, spend DESC
    `
  }
  return rows.map(rowToCampaign)
}

export async function getDistinctAccounts(workspaceId = null) {
  guard()
  const wid = typeof workspaceId === 'string' && workspaceId.trim() ? workspaceId.trim() : null
  if (!wid) return []
  const rows = await sql`SELECT DISTINCT account_name FROM campaigns WHERE workspace_id = ${wid} AND account_name IS NOT NULL ORDER BY account_name`
  return rows.map((r) => r.account_name).filter(Boolean)
}

function rowToCampaign(r) {
  return {
    accountId: r.account_id,
    accountName: r.account_name,
    campaignId: r.campaign_id,
    campaignName: r.campaign_name,
    date: r.date ? r.date.toISOString().slice(0, 10) : null,
    spend: parseFloat(r.spend || 0),
    impressions: parseInt(r.impressions || 0, 10),
    clicks: parseInt(r.clicks || 0, 10),
    codeCountry: r.code_country || '',
    productName: r.product_name || 'Other',
    productWithAnimal: r.product_with_animal || r.product_name || 'Other',
    animal: r.animal || '',
    type: r.type || '',
    raw: r.raw || '',
    namingDate: r.naming_date || '',
  }
}

export async function createSyncRun(since, until, status = 'running', workspaceId = null) {
  guard()
  const [row] = await sql`
    INSERT INTO sync_runs (workspace_id, date_since, date_until, status, campaigns_count)
    VALUES (${workspaceId ? String(workspaceId) : null}, ${since}, ${until}, ${status}, 0)
    RETURNING id, synced_at, date_since, date_until, status
  `
  return row
}

export async function updateSyncRun(id, { status, campaignsCount, errorMessage }) {
  guard()
  await sql`
    UPDATE sync_runs SET status = ${status}, campaigns_count = ${campaignsCount ?? null}, error_message = ${errorMessage ?? null}, synced_at = NOW()
    WHERE id = ${id}
  `
}

export async function deleteWorkspaceSpendData(workspaceId) {
  guard()
  if (!workspaceId) throw new Error('workspaceId required')
  const wid = String(workspaceId)
  // Ordre: supprimer les faits, puis les runs (références ON DELETE SET NULL).
  await sql`DELETE FROM campaigns WHERE workspace_id = ${wid}`
  await sql`DELETE FROM ads_raw WHERE workspace_id = ${wid}`
  await sql`DELETE FROM sync_runs WHERE workspace_id = ${wid}`
}

/** Supprime les campagnes à partir d'une date (pour sync incrémentale) */
export async function deleteCampaignsFromDate(since, workspaceId = null, accountNames = null) {
  guard()
  const names = Array.isArray(accountNames) ? accountNames.filter(Boolean).map((n) => String(n)) : null
  if (names && names.length) {
    // IMPORTANT: ne supprimer que pour les ad accounts ciblés (évite d'effacer les autres comptes du workspace)
    for (const accName of names) {
      if (!workspaceId) {
        await sql`DELETE FROM campaigns WHERE account_name = ${accName} AND date IS NULL`
        await sql`DELETE FROM campaigns WHERE account_name = ${accName} AND date >= ${since}`
      } else {
        await sql`DELETE FROM campaigns WHERE workspace_id = ${String(workspaceId)} AND account_name = ${accName} AND date IS NULL`
        await sql`DELETE FROM campaigns WHERE workspace_id = ${String(workspaceId)} AND account_name = ${accName} AND date >= ${since}`
      }
    }
    return
  }
  if (!workspaceId) {
    await sql`DELETE FROM campaigns WHERE date IS NULL`
    await sql`DELETE FROM campaigns WHERE date >= ${since}`
    return
  }
  await sql`DELETE FROM campaigns WHERE workspace_id = ${String(workspaceId)} AND date IS NULL`
  await sql`DELETE FROM campaigns WHERE workspace_id = ${String(workspaceId)} AND date >= ${since}`
}

/** Insère des campagnes (utilisé par replace et merge) */
export async function insertCampaigns(syncRunId, campaigns, workspaceId = null) {
  guard()
  const BATCH = 100
  for (let i = 0; i < campaigns.length; i += BATCH) {
    const batch = campaigns.slice(i, i + BATCH)
    for (const c of batch) {
      await sql`
        INSERT INTO campaigns (workspace_id, sync_run_id, account_id, account_name, campaign_id, campaign_name, date, spend, impressions, clicks, code_country, product_name, product_with_animal, animal, type, raw, naming_date)
        VALUES (
          ${workspaceId ? String(workspaceId) : null},
          ${syncRunId},
          ${c.accountId || null},
          ${c.accountName || null},
          ${c.campaignId || null},
          ${c.campaignName || null},
          ${c.date || null},
          ${c.spend || 0},
          ${c.impressions || 0},
          ${c.clicks || 0},
          ${c.codeCountry || ''},
          ${c.productName || 'Other'},
          ${c.productWithAnimal || c.productName || 'Other'},
          ${c.animal || ''},
          ${c.type || ''},
          ${c.raw || ''},
          ${c.namingDate || ''}
        )
      `
    }
  }
}

export async function replaceCampaigns(syncRunId, campaigns, workspaceId = null) {
  guard()
  if (!workspaceId) {
    await sql`TRUNCATE TABLE campaigns RESTART IDENTITY CASCADE`
    await insertCampaigns(syncRunId, campaigns, workspaceId)
    return
  }
  await sql`DELETE FROM campaigns WHERE workspace_id = ${String(workspaceId)}`
  await insertCampaigns(syncRunId, campaigns, workspaceId)
}

/** Supprime les ads_raw à partir d'une date */
export async function deleteAdsRawFromDate(since, workspaceId = null) {
  guard()
  if (!workspaceId) {
    await sql`DELETE FROM ads_raw WHERE date >= ${since}`
    return
  }
  await sql`DELETE FROM ads_raw WHERE workspace_id = ${String(workspaceId)} AND date >= ${since}`
}

/** Insère des ads pour Winners */
export async function insertAdsRaw(syncRunId, ads, workspaceId = null) {
  guard()
  const BATCH = 500

  const insertBatch = async (batch, withPurchaseCount) => {
    const cols = withPurchaseCount
      ? ['workspace_id', 'sync_run_id', 'ad_id', 'ad_name', 'account_id', 'account_name', 'date', 'spend', 'impressions', 'clicks', 'purchase_value', 'purchase_count']
      : ['workspace_id', 'sync_run_id', 'ad_id', 'ad_name', 'account_id', 'account_name', 'date', 'spend', 'impressions', 'clicks', 'purchase_value']

    const values = []
    const rows = []
    let p = 1

    for (const a of batch) {
      const row = [
        workspaceId ? String(workspaceId) : null,
        syncRunId,
        a.adId || null,
        a.adName || null,
        a.accountId || null,
        a.accountName || null,
        a.date || null,
        a.spend || 0,
        a.impressions || 0,
        a.clicks || 0,
        a.purchaseValue || 0,
      ]
      if (withPurchaseCount) row.push(a.purchaseCount || 0)
      values.push(...row)
      rows.push(`(${row.map(() => `$${p++}`).join(',')})`)
    }

    const text = `INSERT INTO ads_raw (${cols.join(',')}) VALUES ${rows.join(',')}`
    await sql(text, values)
  }

  for (let i = 0; i < ads.length; i += BATCH) {
    const batch = ads.slice(i, i + BATCH)
    try {
      await insertBatch(batch, true)
    } catch (e) {
      const msg = String(e?.message || '')
      if (!msg.includes('purchase_count')) throw e
      await insertBatch(batch, false)
    }
  }
}

/** Remplace tous les ads_raw (pour full sync) */
export async function replaceAdsRaw(syncRunId, ads, workspaceId = null) {
  guard()
  if (!workspaceId) {
    await sql`TRUNCATE TABLE ads_raw RESTART IDENTITY CASCADE`
    if (ads.length > 0) await insertAdsRaw(syncRunId, ads, workspaceId)
    return
  }
  await sql`DELETE FROM ads_raw WHERE workspace_id = ${String(workspaceId)}`
  if (ads.length > 0) await insertAdsRaw(syncRunId, ads, workspaceId)
}

/** Récupère les ads_raw pour Winners (filtrage par date, account) */
export async function getAdsRaw(since, until, accountName = null, workspaceId = null) {
  guard()
  const wid = typeof workspaceId === 'string' && workspaceId.trim() ? workspaceId.trim() : null
  if (!wid) return []
  let rows
  if (since && until && accountName) {
    rows = await sql`SELECT * FROM ads_raw WHERE workspace_id = ${wid} AND date >= ${since} AND date <= ${until} AND account_name = ${accountName}`
  } else if (accountName) {
    rows = await sql`SELECT * FROM ads_raw WHERE workspace_id = ${wid} AND account_name = ${accountName}`
  } else if (since && until) {
    rows = await sql`SELECT * FROM ads_raw WHERE workspace_id = ${wid} AND date >= ${since} AND date <= ${until}`
  } else {
    rows = await sql`SELECT * FROM ads_raw WHERE workspace_id = ${wid}`
  }
  return rows.map((r) => ({
    adId: r.ad_id,
    adName: r.ad_name,
    accountId: r.account_id,
    accountName: r.account_name,
    date: r.date ? r.date.toISOString().slice(0, 10) : null,
    spend: parseFloat(r.spend || 0),
    impressions: parseInt(r.impressions || 0, 10),
    clicks: parseInt(r.clicks || 0, 10),
    purchaseValue: parseFloat(r.purchase_value || 0),
    purchaseCount: parseInt(r.purchase_count || 0, 10),
  }))
}
