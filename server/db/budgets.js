import { sql, hasDb } from './index.js'

function guard() {
  if (!hasDb()) throw new Error('DATABASE_URL not configured')
}

/** Récupère les budgets par account (campagnes ACTIVE uniquement, pour le budget total / jour) */
export async function getBudgetsByAccount(workspaceId) {
  guard()
  let rows
  try {
    rows = await sql`
      SELECT account_id, account_name,
             SUM(COALESCE(NULLIF(daily_budget, 0), lifetime_budget / 30)) as budget
      FROM campaign_budgets
      WHERE workspace_id = ${String(workspaceId)}
        AND (effective_status = 'ACTIVE' OR effective_status IS NULL)
        AND (has_active_ads IS NULL OR has_active_ads = TRUE)
      GROUP BY account_id, account_name
    `
  } catch (e) {
    if (!String(e?.message || '').includes('has_active_ads')) throw e
    rows = await sql`
      SELECT account_id, account_name,
             SUM(COALESCE(NULLIF(daily_budget, 0), lifetime_budget / 30)) as budget
      FROM campaign_budgets
      WHERE workspace_id = ${String(workspaceId)}
        AND (effective_status = 'ACTIVE' OR effective_status IS NULL)
      GROUP BY account_id, account_name
    `
  }
  const map = {}
  for (const r of rows) {
    const budget = parseFloat(r.budget || 0)
    if (r.account_name) map[r.account_name] = budget
    if (r.account_id) map[r.account_id] = budget
  }
  return map
}

export async function getTotalDailyBudget(workspaceId) {
  guard()
  let rows
  try {
    rows = await sql`
      SELECT SUM(COALESCE(NULLIF(daily_budget, 0), lifetime_budget / 30)) AS total
      FROM campaign_budgets
      WHERE workspace_id = ${String(workspaceId)}
        AND (effective_status = 'ACTIVE' OR effective_status IS NULL)
        AND (has_active_ads IS NULL OR has_active_ads = TRUE)
    `
  } catch (e) {
    if (!String(e?.message || '').includes('has_active_ads')) throw e
    rows = await sql`
      SELECT SUM(COALESCE(NULLIF(daily_budget, 0), lifetime_budget / 30)) AS total
      FROM campaign_budgets
      WHERE workspace_id = ${String(workspaceId)}
        AND (effective_status = 'ACTIVE' OR effective_status IS NULL)
    `
  }
  return parseFloat(rows?.[0]?.total || 0)
}

/** Liste les budgets campagnes actives uniquement */
export async function listCampaignBudgets(workspaceId, accountName = null) {
  guard()
  let rows
  if (accountName) {
    rows = await sql`
      SELECT * FROM campaign_budgets
      WHERE workspace_id = ${String(workspaceId)}
        AND account_name = ${accountName}
        AND (effective_status = 'ACTIVE' OR effective_status IS NULL)
      ORDER BY campaign_name
    `
  } else {
    rows = await sql`
      SELECT * FROM campaign_budgets
      WHERE workspace_id = ${String(workspaceId)}
        AND (effective_status = 'ACTIVE' OR effective_status IS NULL)
      ORDER BY account_name, campaign_name
    `
  }
  return rows.map((r) => ({
    workspaceId: r.workspace_id,
    accountId: r.account_id,
    accountName: r.account_name,
    campaignId: r.campaign_id,
    campaignName: r.campaign_name,
    dailyBudget: parseFloat(r.daily_budget || 0),
    lifetimeBudget: parseFloat(r.lifetime_budget || 0),
    effectiveStatus: r.effective_status || null,
    hasActiveAds: r.has_active_ads === null || r.has_active_ads === undefined ? null : !!r.has_active_ads,
    updatedAt: r.updated_at?.toISOString?.(),
  }))
}

/** Upsert budgets par workspace : DELETE puis INSERT pour éviter toute dépendance à une contrainte UNIQUE (données isolées par workspace_id + account_id + campaign_id). */
export async function upsertBudgets(workspaceId, budgets) {
  guard()
  const wid = String(workspaceId)
  for (const b of budgets) {
    await sql`
      DELETE FROM campaign_budgets
      WHERE workspace_id = ${wid} AND account_id = ${b.accountId} AND campaign_id = ${b.campaignId}
    `
    try {
      await sql`
        INSERT INTO campaign_budgets (workspace_id, account_id, account_name, campaign_id, campaign_name, daily_budget, lifetime_budget, effective_status, has_active_ads, updated_at)
        VALUES (${wid}, ${b.accountId}, ${b.accountName}, ${b.campaignId}, ${b.campaignName}, ${b.dailyBudget || 0}, ${b.lifetimeBudget || 0}, ${b.effectiveStatus || null}, ${b.hasActiveAds ?? null}, NOW())
      `
    } catch (e) {
      if (String(e?.message || '').includes('has_active_ads')) {
        await sql`
          INSERT INTO campaign_budgets (workspace_id, account_id, account_name, campaign_id, campaign_name, daily_budget, lifetime_budget, effective_status, updated_at)
          VALUES (${wid}, ${b.accountId}, ${b.accountName}, ${b.campaignId}, ${b.campaignName}, ${b.dailyBudget || 0}, ${b.lifetimeBudget || 0}, ${b.effectiveStatus || null}, NOW())
        `
      } else {
        throw e
      }
    }
  }
}

export async function deleteWorkspaceBudgets(workspaceId) {
  guard()
  if (!workspaceId) throw new Error('workspaceId required')
  const wid = String(workspaceId)
  await sql`DELETE FROM campaign_budgets WHERE workspace_id = ${wid}`
}
