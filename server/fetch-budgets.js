#!/usr/bin/env node
/**
 * Récupère les budgets des campagnes via Meta API
 * Usage: cd server && node fetch-budgets.js
 * Nécessite: DATABASE_URL, META_ACCESS_TOKEN dans .env
 * Avant: node db/migrate-budgets.js
 */
import 'dotenv/config'
import { fetchMetaDataAllPages } from './services/metaApi.js'
import * as dbBudgets from './db/budgets.js'
import { hasDb } from './db/index.js'

const token = process.env.META_ACCESS_TOKEN

async function run() {
  if (!token) {
    console.error('META_ACCESS_TOKEN requis dans .env')
    process.exit(1)
  }
  if (!hasDb()) {
    console.error('DATABASE_URL requis dans .env')
    process.exit(1)
  }

  console.log('Récupération des campagnes et budgets depuis Meta API…')
  const accountsRes = await fetchMetaDataAllPages(token, '/me/adaccounts', { fields: 'id,name', limit: 500 })
  const accounts = accountsRes.data || []
  const budgetRows = []

  for (const acc of accounts) {
    try {
      const campData = await fetchMetaDataAllPages(token, `/${acc.id}/campaigns`, {
        fields: 'id,name,daily_budget,lifetime_budget',
        limit: 500,
      })
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
          hasActiveAds: null,
        })
      }
      console.log(`  ${acc.name}: ${(campData.data || []).length} campagnes`)
    } catch (e) {
      console.warn(`  Skip ${acc.name}:`, e.message)
    }
  }

  if (budgetRows.length === 0) {
    console.log('Aucune campagne avec budget trouvée.')
    return
  }

  await dbBudgets.upsertBudgets(budgetRows)
  console.log(`\n✓ ${budgetRows.length} budgets enregistrés.`)

  const list = await dbBudgets.listCampaignBudgets()
  console.log('\nAperçu (top 10):')
  list
    .sort((a, b) => (b.dailyBudget || b.lifetimeBudget / 30) - (a.dailyBudget || a.lifetimeBudget / 30))
    .slice(0, 10)
    .forEach((b) => {
      const budgetStr = b.dailyBudget ? `$${b.dailyBudget}/j` : (b.lifetimeBudget ? `$${b.lifetimeBudget} total` : '-')
      console.log(`  ${(b.campaignName || '').slice(0, 50)} | ${b.accountName} | ${budgetStr}`)
    })
}

run().catch((e) => {
  console.error(e)
  process.exit(1)
})
