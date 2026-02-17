#!/usr/bin/env node
/**
 * Recharge et normalise tous les product names dans spend.json
 * Re-parse chaque campaign_name et applique la normalisation pour éviter les doublons
 * Usage: node refresh-product-names.js
 */
import { readFileSync, writeFileSync } from 'fs'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'
import { parseCampaignName } from './utils/campaignNaming.js'
import { extractMarketFromAccount } from './utils/accountNaming.js'

const __dirname = dirname(fileURLToPath(import.meta.url))
const SPEND_PATH = join(__dirname, 'data', 'spend.json')

const raw = JSON.parse(readFileSync(SPEND_PATH, 'utf8'))
const campaigns = raw.campaigns || []

const before = new Set(campaigns.map((c) => c.productWithAnimal || c.productName).filter(Boolean))

let updated = 0
for (const c of campaigns) {
  const parsed = parseCampaignName(c.campaignName || c.raw || '')
  const newProduct = parsed.productName
  const newProductWithAnimal = parsed.productWithAnimal
  const marketFromAccount = extractMarketFromAccount(c.accountName || '')
  const newCodeCountry = marketFromAccount || parsed.codeCountry || ''
  if (c.productName !== newProduct || c.productWithAnimal !== newProductWithAnimal || c.codeCountry !== newCodeCountry) {
    c.productName = newProduct
    c.productWithAnimal = newProductWithAnimal
    c.codeCountry = newCodeCountry
    updated++
  }
}

const after = new Set(campaigns.map((c) => c.productWithAnimal || c.productName).filter(Boolean))

raw._refreshedAt = new Date().toISOString()
writeFileSync(SPEND_PATH, JSON.stringify(raw, null, 2), 'utf8')

console.log('✓ spend.json mis à jour')
console.log('  Avant:', before.size, 'produits uniques')
console.log('  Après:', after.size, 'produits uniques')
console.log('  Lignes modifiées:', updated)
if (before.size > after.size) {
  console.log('  Fusionnés:', [...before].filter((p) => !after.has(p)).join(', '))
}
