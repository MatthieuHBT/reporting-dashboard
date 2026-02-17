import { sql, hasDb } from './index.js'
import { extractMarketFromAccount } from '../utils/accountNaming.js'

function guard() {
  if (!hasDb()) throw new Error('DATABASE_URL not configured')
}

export async function getSyncRuns(limit = 5) {
  guard()
  return sql`
    SELECT id, synced_at, date_since, date_until, status, campaigns_count, error_message
    FROM sync_runs ORDER BY synced_at DESC LIMIT ${limit}
  `
}

export async function getLatestSyncRun() {
  guard()
  const rows = await sql`
    SELECT id, synced_at, date_since, date_until, campaigns_count
    FROM sync_runs WHERE status = 'success'
    ORDER BY synced_at DESC LIMIT 1
  `
  return rows[0] || null
}

export async function getCampaigns(since, until, accountName = null) {
  guard()
  // accountName = filtre "market" : on garde les campagnes dont le NOM indique ce market (CBO_MX_, CBO_IT_, etc.)
  // inclut les campagnes de tous les comptes (ex: CBO_MX_ sur compte IT → visibles quand on filtre MX)
  const market = accountName ? extractMarketFromAccount(accountName) : null
  const namePattern = market ? `^(CBO|ABO)_${market}_` : null

  let rows
  if (since && until && namePattern) {
    rows = await sql`SELECT * FROM campaigns WHERE date >= ${since} AND date <= ${until} AND campaign_name ~* ${namePattern} ORDER BY campaign_name, date DESC, spend DESC`
  } else if (namePattern) {
    rows = await sql`SELECT * FROM campaigns WHERE campaign_name ~* ${namePattern} ORDER BY campaign_name, date DESC, spend DESC`
  } else if (since && until && accountName) {
    rows = await sql`SELECT * FROM campaigns WHERE date >= ${since} AND date <= ${until} AND account_name = ${accountName} ORDER BY campaign_name, date DESC, spend DESC`
  } else if (accountName) {
    rows = await sql`SELECT * FROM campaigns WHERE account_name = ${accountName} ORDER BY campaign_name, date DESC, spend DESC`
  } else if (since && until) {
    rows = await sql`SELECT * FROM campaigns WHERE date >= ${since} AND date <= ${until} ORDER BY campaign_name, date DESC, spend DESC`
  } else {
    rows = await sql`SELECT * FROM campaigns ORDER BY campaign_name, date DESC, spend DESC`
  }
  return rows.map(rowToCampaign)
}

export async function getDistinctAccounts() {
  guard()
  const rows = await sql`SELECT DISTINCT account_name FROM campaigns WHERE account_name IS NOT NULL ORDER BY account_name`
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

export async function createSyncRun(since, until, status = 'running') {
  guard()
  const [row] = await sql`
    INSERT INTO sync_runs (date_since, date_until, status, campaigns_count)
    VALUES (${since}, ${until}, ${status}, 0)
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

/** Supprime les campagnes à partir d'une date (pour sync incrémentale) */
export async function deleteCampaignsFromDate(since) {
  guard()
  await sql`DELETE FROM campaigns WHERE date >= ${since}`
}

/** Insère des campagnes (utilisé par replace et merge) */
export async function insertCampaigns(syncRunId, campaigns) {
  guard()
  const BATCH = 100
  for (let i = 0; i < campaigns.length; i += BATCH) {
    const batch = campaigns.slice(i, i + BATCH)
    for (const c of batch) {
      await sql`
        INSERT INTO campaigns (sync_run_id, account_id, account_name, campaign_id, campaign_name, date, spend, impressions, clicks, code_country, product_name, product_with_animal, animal, type, raw, naming_date)
        VALUES (
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

export async function replaceCampaigns(syncRunId, campaigns) {
  guard()
  await sql`TRUNCATE TABLE campaigns RESTART IDENTITY CASCADE`
  await insertCampaigns(syncRunId, campaigns)
}
