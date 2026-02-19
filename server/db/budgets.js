import { sql, hasDb } from './index.js'

function guard() {
  if (!hasDb()) throw new Error('DATABASE_URL not configured')
}

/** Récupère les budgets par account (campagnes ACTIVE uniquement, pour le budget total / jour) */
export async function getBudgetsByAccount() {
  guard()
  const rows = await sql`
    SELECT account_id, account_name,
           SUM(COALESCE(NULLIF(daily_budget, 0), lifetime_budget / 30)) as budget
    FROM campaign_budgets
    WHERE (effective_status = 'ACTIVE' OR effective_status IS NULL)
    GROUP BY account_id, account_name
  `
  const map = {}
  for (const r of rows) {
    const budget = parseFloat(r.budget || 0)
    if (r.account_name) map[r.account_name] = budget
    if (r.account_id) map[r.account_id] = budget
  }
  return map
}

export async function getTotalDailyBudget() {
  guard()
  const rows = await sql`
    SELECT SUM(COALESCE(NULLIF(daily_budget, 0), lifetime_budget / 30)) AS total
    FROM campaign_budgets
    WHERE (effective_status = 'ACTIVE' OR effective_status IS NULL)
  `
  return parseFloat(rows?.[0]?.total || 0)
}

/** Liste les budgets campagnes actives uniquement */
export async function listCampaignBudgets(accountName = null) {
  guard()
  let rows
  if (accountName) {
    rows = await sql`
      SELECT * FROM campaign_budgets
      WHERE account_name = ${accountName} AND (effective_status = 'ACTIVE' OR effective_status IS NULL)
      ORDER BY campaign_name
    `
  } else {
    rows = await sql`
      SELECT * FROM campaign_budgets
      WHERE effective_status = 'ACTIVE' OR effective_status IS NULL
      ORDER BY account_name, campaign_name
    `
  }
  return rows.map((r) => ({
    accountId: r.account_id,
    accountName: r.account_name,
    campaignId: r.campaign_id,
    campaignName: r.campaign_name,
    dailyBudget: parseFloat(r.daily_budget || 0),
    lifetimeBudget: parseFloat(r.lifetime_budget || 0),
    effectiveStatus: r.effective_status || null,
    updatedAt: r.updated_at?.toISOString?.(),
  }))
}

export async function upsertBudgets(budgets) {
  guard()
  for (const b of budgets) {
    await sql`
      INSERT INTO campaign_budgets (account_id, account_name, campaign_id, campaign_name, daily_budget, lifetime_budget, effective_status, updated_at)
      VALUES (${b.accountId}, ${b.accountName}, ${b.campaignId}, ${b.campaignName}, ${b.dailyBudget || 0}, ${b.lifetimeBudget || 0}, ${b.effectiveStatus || null}, NOW())
      ON CONFLICT (account_id, campaign_id) DO UPDATE SET
        campaign_name = EXCLUDED.campaign_name,
        daily_budget = EXCLUDED.daily_budget,
        lifetime_budget = EXCLUDED.lifetime_budget,
        effective_status = EXCLUDED.effective_status,
        updated_at = NOW()
    `
  }
}
