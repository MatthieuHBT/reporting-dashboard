import 'dotenv/config'
import express from 'express'
import cors from 'cors'
import jwt from 'jsonwebtoken'
import { readFileSync, existsSync } from 'fs'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'
import { fetchMetaData, fetchMetaDataAllPages } from './services/metaApi.js'
import { parseCampaignName } from './utils/campaignNaming.js'
import { extractMarketFromAccount } from './utils/accountNaming.js'
import { hasDb } from './db/index.js'

const __dirname = dirname(fileURLToPath(import.meta.url))
const DATA_DIR = join(__dirname, 'data')
const JWT_SECRET = process.env.JWT_SECRET || 'dev-secret-change-in-prod'

/** Calcule since/until (YYYY-MM-DD) depuis datePreset ou since/until query */
function getDateRange(datePreset, since, until) {
  if (since && until) return { since, until }
  const today = new Date().toISOString().slice(0, 10)
  const pad = (n) => String(n).padStart(2, '0')
  const toStr = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
  const d = new Date()
  switch (datePreset) {
    case 'full': return { since: '2025-01-01', until: today }
    case 'today': return { since: today, until: today }
    case 'yesterday':
      d.setDate(d.getDate() - 1)
      return { since: toStr(d), until: toStr(d) }
    case 'last_7d':
      d.setDate(d.getDate() - 6)
      return { since: toStr(d), until: today }
    case 'last_14d':
      d.setDate(d.getDate() - 13)
      return { since: toStr(d), until: today }
    case 'last_30d':
      d.setDate(d.getDate() - 29)
      return { since: toStr(d), until: today }
    default:
      return null
  }
}

/** Nombre de jours dans la plage (since/until inclus), minimum 1 */
function getDaysInRange(since, until) {
  if (!since || !until) return 1
  const start = new Date(since)
  const end = new Date(until)
  if (isNaN(start.getTime()) || isNaN(end.getTime())) return 1
  const diff = Math.round((end - start) / (24 * 60 * 60 * 1000)) + 1
  return Math.max(1, diff)
}

/** Récupère tous les ad accounts Meta (y compris sans campagnes) et les fusionne avec la liste existante */
async function mergeAllAdAccounts(existingAccounts = []) {
  let token = process.env.META_ACCESS_TOKEN
  if (!token && hasDb()) {
    try {
      const { getMetaToken } = await import('./db/settings.js')
      token = await getMetaToken()
    } catch {}
  }
  if (!token) return existingAccounts
  try {
    const data = await fetchMetaData(token, '/me/adaccounts', { fields: 'id,name', limit: 500 })
    const metaNames = (data.data || []).map((a) => a.name).filter(Boolean)
    const merged = [...new Set([...existingAccounts, ...metaNames])].sort()
    return merged
  } catch {
    return existingAccounts
  }
}

/** Filtre les campagnes par plage de dates (date au format YYYY-MM-DD) */
function filterByDateRange(items, since, until, dateKey = 'date') {
  if (!since || !until) return items
  return items.filter((r) => {
    const d = r[dateKey]
    if (!d || typeof d !== 'string') return false
    const dNorm = d.length === 10 ? d : d.split('T')[0]
    return dNorm >= since && dNorm <= until
  })
}

const app = express()
const PORT = process.env.PORT || 3003

const corsOrigins = [
  'http://localhost:3002', 'http://localhost:3004', 'http://localhost:3005',
  'http://127.0.0.1:3002', 'http://127.0.0.1:3004', 'http://127.0.0.1:3005',
]
if (process.env.VERCEL_URL) {
  corsOrigins.push(`https://${process.env.VERCEL_URL}`, `https://www.${process.env.VERCEL_URL}`)
}
if (process.env.FRONTEND_URL) corsOrigins.push(process.env.FRONTEND_URL)
app.use(cors({ origin: corsOrigins }))
app.use(express.json())

// Vercel: restore original path (rewrite sends /api/xxx → /api?__originalPath=xxx)
app.use((req, res, next) => {
  const p = req.query?.__originalPath
  if (p && typeof p === 'string') {
    const rest = (req.url.split('?')[1] || '').replace(/__originalPath=[^&]+&?/, '').replace(/&$/, '')
    req.url = '/api/' + p + (rest ? '?' + rest : '')
    delete req.query.__originalPath
  }
  next()
})

// Health check
app.get('/api/health', (req, res) => {
  res.json({ ok: true })
})

// Auth: store token in memory (use DB/Redis in prod)
// Auto-load token from .env for demo/default (toujours dispo)
let storedToken = process.env.META_ACCESS_TOKEN || null
let tokenExpiry = storedToken ? Date.now() + 365 * 24 * 60 * 60 * 1000 : null

app.post('/api/auth/login', (req, res) => {
  const { accessToken } = req.body
  if (!accessToken) {
    return res.status(400).json({ error: 'Access token required' })
  }
  storedToken = accessToken
  tokenExpiry = Date.now() + 60 * 60 * 1000 // 1h
  res.json({ success: true })
})

app.post('/api/auth/logout', (req, res) => {
  storedToken = null
  tokenExpiry = null
  res.json({ success: true })
})

app.get('/api/auth/status', (req, res) => {
  res.json({
    connected: !!storedToken,
    expiresAt: tokenExpiry
  })
})

// Auth DB (Neon) : login / logout
app.post('/api/auth/db/login', async (req, res) => {
  if (!hasDb()) {
    return res.status(503).json({ error: 'Database not configured (DATABASE_URL)' })
  }
  try {
    const { findUserByEmail, verifyPassword, getUserPages } = await import('./db/auth.js')
    const { email, password } = req.body || {}
    if (!email || !password) {
      return res.status(400).json({ error: 'Email and password required' })
    }
    const user = await findUserByEmail(email)
    if (!user || !(await verifyPassword(password, user.password_hash))) {
      return res.status(401).json({ error: 'Invalid email or password' })
    }
    const pages = await getUserPages(user.id)
    const token = jwt.sign(
      { id: user.id, email: user.email },
      JWT_SECRET,
      { expiresIn: '7d' }
    )
    res.json({
      token,
      user: { id: user.id, email: user.email, name: user.name, role: user.role, pages },
    })
  } catch (err) {
    console.error(err)
    res.status(500).json({ error: err.message || 'Login failed' })
  }
})

function requireDbUser(req, res, next) {
  const auth = req.headers.authorization
  const token = auth?.startsWith('Bearer ') ? auth.slice(7) : null
  if (!token) {
    return res.status(401).json({ error: 'Authentication required' })
  }
  try {
    const payload = jwt.verify(token, JWT_SECRET)
    req.user = payload
    next()
  } catch {
    res.status(401).json({ error: 'Invalid or expired token' })
  }
}

app.get('/api/auth/db/me', requireDbUser, async (req, res) => {
  try {
    const { findUserByEmail, getUserPages } = await import('./db/auth.js')
    const user = await findUserByEmail(req.user.email)
    if (!user) return res.status(401).json({ error: 'User not found' })
    const pages = await getUserPages(user.id)
    res.json({ user: { id: user.id, email: user.email, name: user.name, role: user.role, pages } })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

async function requireDbAdmin(req, res, next) {
  try {
    const { findUserByEmail } = await import('./db/auth.js')
    const user = await findUserByEmail(req.user.email)
    if (!user || user.role !== 'admin') {
      return res.status(403).json({ error: 'Admin required' })
    }
    req.dbUser = user
    next()
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
}

// Settings: Meta token stocké en BDD (admin only)
app.get('/api/settings/meta-token', requireDbUser, async (req, res) => {
  if (!hasDb()) return res.status(503).json({ error: 'Database not configured' })
  try {
    const { getMetaToken } = await import('./db/settings.js')
    const token = await getMetaToken()
    res.json({ configured: !!token })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

app.post('/api/settings/meta-token', requireDbUser, requireDbAdmin, async (req, res) => {
  if (!hasDb()) return res.status(503).json({ error: 'Database not configured' })
  try {
    const { setMetaToken } = await import('./db/settings.js')
    const token = (req.body?.token || '').trim() || null
    await setMetaToken(token)
    res.json({ success: true, configured: !!token })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// Test Meta token (admin): vérifie que le token fonctionne avec l'API Meta
app.post('/api/settings/meta-token/test', requireDbUser, requireDbAdmin, async (req, res) => {
  let metaToken = process.env.META_ACCESS_TOKEN || null
  if (!metaToken && hasDb()) {
    try {
      const { getMetaToken } = await import('./db/settings.js')
      metaToken = await getMetaToken()
    } catch {}
  }
  if (!metaToken) {
    return res.status(400).json({ error: 'Aucun token Meta configuré. Enregistre un token dans les Settings ou définis META_ACCESS_TOKEN.' })
  }
  try {
    const data = await fetchMetaData(metaToken, '/me/adaccounts', { fields: 'id,name', limit: 1 })
    const count = (data.data || []).length
    res.json({ ok: true, message: `Token valide — ${count} ad account(s) accessible(s).`, accountsCount: count })
  } catch (err) {
    const is190 = err.status === 401
    res.status(400).json({
      error: err.message || 'Échec de la connexion Meta',
      hint: is190
        ? 'Token expiré ou invalide. Génère un nouveau token dans Graph API Explorer (ads_management, ads_read, business_management).'
        : null,
    })
  }
})

// Users (admin only, DB)
app.get('/api/users', requireDbUser, requireDbAdmin, async (req, res) => {
  if (!hasDb()) return res.status(503).json({ error: 'Database not configured' })
  try {
    const { listUsers } = await import('./db/auth.js')
    const users = await listUsers()
    res.json(users)
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

app.post('/api/users', requireDbUser, requireDbAdmin, async (req, res) => {
  if (!hasDb()) return res.status(503).json({ error: 'Database not configured' })
  try {
    const { createUser } = await import('./db/auth.js')
    const { email, password, name, role, pages } = req.body || {}
    if (!email?.trim() || !password?.trim() || !name?.trim()) {
      return res.status(400).json({ error: 'Email, password and name required' })
    }
    const user = await createUser({
      email: email.trim(),
      password,
      name: name.trim(),
      role: role || 'team',
      pages: Array.isArray(pages) ? pages : ['spend'],
    })
    const pagesRes = await (await import('./db/auth.js')).getUserPages(user.id)
    res.status(201).json({ id: user.id, email: user.email, name: user.name, role: user.role, pages: pagesRes })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

app.patch('/api/users/:id/pages', requireDbUser, requireDbAdmin, async (req, res) => {
  if (!hasDb()) return res.status(503).json({ error: 'Database not configured' })
  try {
    const { updateUserPages } = await import('./db/auth.js')
    const { id } = req.params
    const { pages } = req.body || {}
    await updateUserPages(id, Array.isArray(pages) ? pages : [])
    res.json({ success: true })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

app.delete('/api/users/:id', requireDbUser, requireDbAdmin, async (req, res) => {
  if (!hasDb()) return res.status(503).json({ error: 'Database not configured' })
  try {
    const { deleteUser, listUsers } = await import('./db/auth.js')
    const users = await listUsers()
    if (users.length <= 1) return res.status(400).json({ error: 'Cannot delete the last user' })
    await deleteUser(req.params.id)
    res.json({ success: true })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// Refresh: Meta API → DB (token: BDD > .env > body)
app.post('/api/refresh', requireDbUser, async (req, res) => {
  let metaToken = req.body?.accessToken || process.env.META_ACCESS_TOKEN || storedToken
  if (!metaToken && hasDb()) {
    try {
      const { getMetaToken } = await import('./db/settings.js')
      metaToken = await getMetaToken()
    } catch {}
  }
  if (!metaToken) {
    return res.status(400).json({ error: 'Configure Meta token in Settings (admin)' })
  }
  if (!hasDb()) {
    return res.status(503).json({ error: 'Database not configured (DATABASE_URL)' })
  }
  try {
    const forceFull = req.query.full === '1' || req.body?.full === true
    const skipAds = req.query.skipAds === '1' || req.body?.skipAds === true
    const winnersOnly = req.query.winnersOnly === '1' || req.body?.winnersOnly === true
    const winnersDays = req.query.days ? parseInt(req.query.days, 10) : null
    const { runFullSync } = await import('./services/syncToDb.js')
    const result = await runFullSync(metaToken, forceFull, skipAds, winnersOnly, winnersDays)
    res.json(result)
  } catch (err) {
    const msg = err?.message || err?.toString?.() || 'Refresh failed'
    console.error('[refresh]', err)
    let hint = null
    if (msg?.includes('timeout') || err?.code === 'ETIMEDOUT') {
      hint = 'Sync trop longue (timeout). Essaie un sync rapide (Sync rapide) ou winners only.'
    } else if (err?.status === 401 || /invalid|expired|190|access token/i.test(msg)) {
      hint = 'Token Meta expiré ou invalide. Va dans Settings → Tester le token, puis génère un nouveau token dans Graph API Explorer.'
    }
    if (!res.headersSent) {
      res.status(500).json({ error: msg, hint })
    }
  }
})

function requireAuth(req, res, next) {
  if (!storedToken) {
    return res.status(401).json({ error: 'Not authenticated. Please connect with Meta.' })
  }
  next()
}

// Ad accounts
app.get('/api/ad-accounts', requireAuth, async (req, res) => {
  try {
    const data = await fetchMetaData(storedToken, '/me/adaccounts', {
      fields: 'id,name,account_status,currency'
    })
    res.json(data)
  } catch (err) {
    console.error(err)
    res.status(err.status || 500).json({ error: err.message || 'Failed to fetch ad accounts' })
  }
})

// Spend aujourd'hui en direct depuis Meta (pour afficher le spend du jour)
app.get('/api/reports/spend-today', async (req, res) => {
  if (!hasDb()) return res.status(503).json({ error: 'Database not configured' })
  let metaToken = process.env.META_ACCESS_TOKEN
  if (!metaToken) {
    try {
      const { getMetaToken } = await import('./db/settings.js')
      metaToken = await getMetaToken()
    } catch {}
  }
  if (!metaToken) {
    return res.status(400).json({ error: 'Configure Meta token in Settings (admin)' })
  }
  const today = new Date().toISOString().slice(0, 10)
  const timeRange = JSON.stringify({ since: today, until: today })
  try {
    const data = await fetchMetaData(metaToken, '/me/adaccounts', { fields: 'id,name', limit: 500 })
    const accounts = data.data || []
    const campaigns = []
    const byAccount = {}
    for (const acc of accounts) {
      try {
        const insights = await fetchMetaData(metaToken, `/${acc.id}/insights`, {
          fields: 'spend,impressions,clicks,campaign_name,campaign_id',
          level: 'campaign',
          time_increment: 1,
          limit: 500,
          time_range: timeRange,
        })
        const list = insights.data || []
        for (const c of list) {
          const parsed = parseCampaignName(c.campaign_name || '')
          const { date: _namingDate, ...restParsed } = parsed
          const marketFromAccount = extractMarketFromAccount(acc.name)
          const codeCountry = restParsed.codeCountry || marketFromAccount || ''
          const row = {
            accountId: acc.id,
            accountName: acc.name,
            campaignId: c.campaign_id,
            campaignName: c.campaign_name,
            date: c.date_start || c.date_stop || today,
            spend: parseFloat(c.spend || 0),
            impressions: parseInt(c.impressions || 0, 10),
            clicks: parseInt(c.clicks || 0, 10),
            codeCountry,
            ...restParsed,
            namingDate: _namingDate,
          }
          campaigns.push(row)
          const key = acc.name || acc.id
          byAccount[key] = (byAccount[key] || 0) + row.spend
        }
      } catch (e) {
        console.warn(`Spend today: skip ${acc.name}:`, e.message)
      }
    }
    const totalSpendToday = campaigns.reduce((s, r) => s + r.spend, 0)
    res.json({ campaigns, totalSpendToday: Math.round(totalSpendToday * 100) / 100, byAccount })
  } catch (err) {
    console.error('[spend-today]', err)
    res.status(err.status || 500).json({ error: err?.message || 'Failed to fetch spend today' })
  }
})

// Spend report: DB si configuré, sinon data/spend.json, sinon API Meta
app.get('/api/reports/spend', async (req, res) => {
  const { datePreset, since, until, account } = req.query
  const range = getDateRange(datePreset, since, until)
  const accountName = account || null

  if (hasDb()) {
    try {
      const dbSpend = await import('./db/spend.js')
      const filteredCampaigns = await dbSpend.getCampaigns(range?.since, range?.until, accountName)
      const fromDb = await dbSpend.getDistinctAccounts()
      const allAccounts = await mergeAllAdAccounts(fromDb)
      let budgetByAccount = {}
      try {
        const dbBudgets = await import('./db/budgets.js')
        budgetByAccount = await dbBudgets.getBudgetsByAccount()
      } catch (_) {}
      const byAccount = {}
      const byProduct = {}
      const byMarket = {}
      for (const r of filteredCampaigns) {
        const accKey = r.accountName || r.accountId
        byAccount[accKey] = (byAccount[accKey] || { spend: 0, impressions: 0, budget: 0 })
        byAccount[accKey].spend += r.spend || 0
        byAccount[accKey].impressions += r.impressions || 0
        byAccount[accKey].accountName = r.accountName
        byAccount[accKey].accountId = r.accountId
        byAccount[accKey].budget = budgetByAccount[accKey] || 0
        const prodKey = r.productWithAnimal || (r.animal ? `${(r.productName || 'Other').trim()} ${r.animal}`.trim() : (r.productName || 'Other'))
        byProduct[prodKey] = (byProduct[prodKey] || { spend: 0, impressions: 0 })
        byProduct[prodKey].spend += r.spend || 0
        byProduct[prodKey].impressions += r.impressions || 0
        byProduct[prodKey].product = prodKey
        const mktKey = r.codeCountry || 'Unknown'
        byMarket[mktKey] = (byMarket[mktKey] || { spend: 0 })
        byMarket[mktKey].spend += r.spend || 0
        byMarket[mktKey].market = mktKey
      }
      const daysInRange = getDaysInRange(range?.since, range?.until)
      const byAccountList = Object.values(byAccount).map((a) => {
        const dailyBudget = parseFloat(a.budget) || 0
        const budgetPeriod = Math.round(dailyBudget * daysInRange * 100) / 100
        return {
          ...a,
          dailyBudget,
          budgetPeriod,
          budget: budgetPeriod,
        }
      })
      const totalDailyBudget = byAccountList.reduce((s, a) => s + (a.dailyBudget || 0), 0)
      const totalBudgetPeriod = Math.round(totalDailyBudget * daysInRange * 100) / 100
      return res.json({
        campaigns: filteredCampaigns,
        byAccount: byAccountList,
        byProduct: Object.values(byProduct),
        byMarket: Object.values(byMarket),
        totalSpend: filteredCampaigns.reduce((s, r) => s + (r.spend || 0), 0),
        accounts: allAccounts,
        daysInRange,
        totalDailyBudget: Math.round(totalDailyBudget * 100) / 100,
        totalBudgetPeriod,
      })
    } catch (err) {
      console.error('DB spend error:', err)
    }
  }

  const spendPath = join(DATA_DIR, 'spend.json')
  if (existsSync(spendPath)) {
    try {
      const raw = JSON.parse(readFileSync(spendPath, 'utf8'))
      const { _syncedAt, _datePreset, _dateRange, campaigns, ...rest } = raw
      const { datePreset, since, until, account } = req.query
      const range = getDateRange(datePreset, since, until)
      let filteredCampaigns = campaigns || []
      if (range) {
        filteredCampaigns = filterByDateRange(campaigns || [], range.since, range.until)
      }
      if (account) {
        const { extractMarketFromAccount } = await import('./utils/accountNaming.js')
        const { parseCampaignName } = await import('./utils/campaignNaming.js')
        const accountMarket = extractMarketFromAccount(account)
        filteredCampaigns = filteredCampaigns.filter((c) => {
          const nameCode = parseCampaignName(c.campaignName || '').codeCountry
          return nameCode ? nameCode === accountMarket : false
        })
      }
      const fromCampaigns = [...new Set((campaigns || []).map((c) => c.accountName).filter(Boolean))]
      const allAccounts = await mergeAllAdAccounts(fromCampaigns)
      const byAccount = {}
      const byProduct = {}
      const byMarket = {}
      for (const r of filteredCampaigns) {
        const accKey = r.accountName || r.accountId
        byAccount[accKey] = (byAccount[accKey] || { spend: 0, impressions: 0 })
        byAccount[accKey].spend += r.spend || 0
        byAccount[accKey].impressions += r.impressions || 0
        byAccount[accKey].accountName = r.accountName
        byAccount[accKey].accountId = r.accountId
        const prodKey = r.productWithAnimal || (r.animal ? `${(r.productName || 'Other').trim()} ${r.animal}`.trim() : (r.productName || 'Other'))
        byProduct[prodKey] = (byProduct[prodKey] || { spend: 0, impressions: 0 })
        byProduct[prodKey].spend += r.spend || 0
        byProduct[prodKey].impressions += r.impressions || 0
        byProduct[prodKey].product = prodKey
        const mktKey = r.codeCountry || 'Unknown'
        byMarket[mktKey] = (byMarket[mktKey] || { spend: 0 })
        byMarket[mktKey].spend += r.spend || 0
        byMarket[mktKey].market = mktKey
      }
      return res.json({
        campaigns: filteredCampaigns,
        byAccount: Object.values(byAccount),
        byProduct: Object.values(byProduct),
        byMarket: Object.values(byMarket),
        totalSpend: filteredCampaigns.reduce((s, r) => s + (r.spend || 0), 0),
        accounts: allAccounts,
      })
    } catch (e) {
      return res.status(500).json({ error: 'Failed to read spend data' })
    }
  }
  // Fallback: appels API (si token dispo)
  if (!storedToken) {
    return res.status(503).json({ error: 'Run npm run sync first to fetch data, or connect Meta token' })
  }
  requireAuth(req, res, () => fetchSpendFromApi(req, res))
})

async function fetchSpendFromApi(req, res) {
  const { datePreset, since, until, account } = req.query
  const useCustomRange = since && until
  const insightsParams = {
    fields: 'spend,impressions,clicks,campaign_name,campaign_id',
    level: 'campaign',
    time_increment: 1,
    limit: 500
  }
  if (useCustomRange) {
    insightsParams.time_range = JSON.stringify({ since, until })
  } else {
    insightsParams.date_preset = datePreset || 'last_7d'
  }
  try {
    const data = await fetchMetaData(storedToken, '/me/adaccounts', {
      fields: 'id,name',
      limit: 500
    })
    const accounts = data.data || []
    const results = []

    for (const acc of accounts) {
      try {
        const insights = await fetchMetaData(storedToken, `/${acc.id}/insights`, insightsParams)
        const campaigns = insights.data || []
        for (const c of campaigns) {
          const parsed = parseCampaignName(c.campaign_name || '')
          const { date: _namingDate, ...restParsed } = parsed
          results.push({
            accountId: acc.id,
            accountName: acc.name,
            campaignId: c.campaign_id,
            campaignName: c.campaign_name,
            date: c.date_start || c.date_stop || null,
            spend: parseFloat(c.spend || 0),
            impressions: parseInt(c.impressions || 0, 10),
            clicks: parseInt(c.clicks || 0, 10),
            ...restParsed,
            namingDate: _namingDate,
          })
        }
      } catch (e) {
        console.warn(`Skip account ${acc.name}:`, e.message)
      }
    }

    // Filtrer par market du nom de campagne quand account sélectionné (ex: IT account → CBO_IT_... uniquement)
    let filtered = results
    if (account) {
      const accountMarket = extractMarketFromAccount(account)
      filtered = results.filter((r) => {
        const nameCode = parseCampaignName(r.campaignName || '').codeCountry
        return nameCode && nameCode === accountMarket
      })
    }

    const byAccount = {}
    const byProduct = {}
    const byMarket = {}
    for (const r of filtered) {
      const accKey = r.accountName || r.accountId
      byAccount[accKey] = (byAccount[accKey] || { spend: 0, impressions: 0 })
      byAccount[accKey].spend += r.spend
      byAccount[accKey].impressions += r.impressions
      byAccount[accKey].accountName = r.accountName
      byAccount[accKey].accountId = r.accountId
      const prodKey = r.productName || 'Other'
      byProduct[prodKey] = (byProduct[prodKey] || { spend: 0, impressions: 0 })
      byProduct[prodKey].spend += r.spend
      byProduct[prodKey].impressions += r.impressions
      byProduct[prodKey].product = prodKey
      const mktKey = r.codeCountry || 'Unknown'
      byMarket[mktKey] = (byMarket[mktKey] || { spend: 0 })
      byMarket[mktKey].spend += r.spend
      byMarket[mktKey].market = mktKey
    }

    const allAccountNames = (data.data || []).map((a) => a.name).filter(Boolean)
    res.json({
      campaigns: filtered,
      byAccount: Object.values(byAccount),
      byProduct: Object.values(byProduct),
      byMarket: Object.values(byMarket),
      accounts: allAccountNames,
      totalSpend: filtered.reduce((s, r) => s + r.spend, 0)
    })
  } catch (err) {
    console.error(err)
    res.status(err.status || 500).json({ error: err.message || 'Failed to fetch spend' })
  }
}

// Winners: BDD (ads_raw) > data/winners.json > API Meta live
app.get('/api/reports/winners', async (req, res) => {
  const { datePreset, since, until, account } = req.query
  const range = getDateRange(datePreset, since, until)

  if (hasDb()) {
    try {
      const dbSpend = await import('./db/spend.js')
      const rows = await dbSpend.getAdsRaw(range?.since, range?.until, account || null)
      const byAd = {}
      for (const r of rows) {
        const key = r.adId || r.adName
        if (!byAd[key]) {
          byAd[key] = { adName: r.adName, adId: r.adId, spend: 0, impressions: 0, clicks: 0, purchaseValue: 0 }
        }
        byAd[key].spend += r.spend || 0
        byAd[key].impressions += r.impressions || 0
        byAd[key].clicks += r.clicks || 0
        byAd[key].purchaseValue += r.purchaseValue || 0
      }
      const { parseAdName } = await import('./utils/parseAdNaming.js')
      let aggregated = Object.values(byAd)
        .sort((a, b) => b.spend - a.spend)
        .map((ad, i) => {
          const parsed = parseAdName(ad.adName)
          const roas = ad.spend > 0 && ad.purchaseValue > 0 ? Math.round((ad.purchaseValue / ad.spend) * 100) / 100 : null
          return {
            rank: i + 1,
            adName: ad.adName,
            market: parsed.codeCountry || '-',
            product: parsed.productName || 'Other',
            format: parsed.format || '-',
            spend: ad.spend,
            impressions: ad.impressions,
            clicks: ad.clicks,
            roas: roas ?? '-',
            ctr: ad.impressions > 0 ? Math.round((ad.clicks / ad.impressions) * 1000) / 10 : null,
          }
        })
      if (account) {
        const targetMkt = (extractMarketFromAccount(account) || parseCampaignName(account).codeCountry || '').toUpperCase()
        if (targetMkt) {
          aggregated = aggregated.filter((w) => (w.market || '').toUpperCase() === targetMkt)
          aggregated = aggregated.map((w, i) => ({ ...w, rank: i + 1 }))
        }
      }
      return res.json({ winners: aggregated })
    } catch (err) {
      console.error('DB winners error:', err)
    }
  }

  const winnersPath = join(DATA_DIR, 'winners.json')
  if (existsSync(winnersPath)) {
    try {
      const raw = JSON.parse(readFileSync(winnersPath, 'utf8'))
      const { _syncedAt, _datePreset, _dateRange, adsRaw } = raw
      let rows = adsRaw || []
      const { datePreset, since, until, account } = req.query
      const range = getDateRange(datePreset, since, until)
      if (range) {
        rows = filterByDateRange(rows, range.since, range.until)
      }
      const byAd = {}
      for (const r of rows) {
        const key = r.adId || r.adName
        if (!byAd[key]) {
          byAd[key] = {
            adName: r.adName,
            adId: r.adId,
            spend: 0,
            impressions: 0,
            clicks: 0,
            purchaseValue: 0,
          }
        }
        byAd[key].spend += r.spend || 0
        byAd[key].impressions += r.impressions || 0
        byAd[key].clicks += r.clicks || 0
        byAd[key].purchaseValue += r.purchaseValue || 0
      }
      const { parseAdName } = await import('./utils/parseAdNaming.js')
      let aggregated = Object.values(byAd)
        .sort((a, b) => b.spend - a.spend)
        .map((ad, i) => {
          const parsed = parseAdName(ad.adName)
          const roas = ad.spend > 0 && ad.purchaseValue > 0
            ? Math.round((ad.purchaseValue / ad.spend) * 100) / 100
            : null
          return {
            rank: i + 1,
            adName: ad.adName,
            market: parsed.codeCountry || '-',
            product: parsed.productName || 'Other',
            format: parsed.format || '-',
            spend: ad.spend,
            impressions: ad.impressions,
            clicks: ad.clicks,
            roas: roas ?? '-',
            ctr: ad.impressions > 0 ? Math.round((ad.clicks / ad.impressions) * 1000) / 10 : null,
          }
        })
      if (account) {
        const targetMkt = (extractMarketFromAccount(account) || parseCampaignName(account).codeCountry || '').toUpperCase()
        if (targetMkt) {
          aggregated = aggregated.filter((w) => (w.market || '').toUpperCase() === targetMkt)
          aggregated = aggregated.map((w, i) => ({ ...w, rank: i + 1 }))
        }
      }
      return res.json({ winners: aggregated })
    } catch (e) {
      return res.status(500).json({ error: 'Failed to read winners data' })
    }
  }
  if (!storedToken) {
    return res.status(503).json({ error: 'Run npm run sync first to fetch data, or connect Meta token' })
  }
  requireAuth(req, res, () => fetchWinnersFromApi(req, res))
})

async function fetchWinnersFromApi(req, res) {
  const { parseAdName } = await import('./utils/parseAdNaming.js')
  const { datePreset, since, until, account } = req.query
  const useCustomRange = since && until
  const insightsParams = {
    fields: 'ad_name,ad_id,spend,impressions,clicks,action_values',
    level: 'ad',
    limit: 500,
  }
  if (useCustomRange) {
    insightsParams.time_range = JSON.stringify({ since, until })
  } else {
    insightsParams.date_preset = datePreset || 'last_7d'
  }
  try {
    const data = await fetchMetaData(storedToken, '/me/adaccounts', {
      fields: 'id,name',
      limit: 500,
    })
    let accounts = data.data || []
    if (account) {
      const targetMkt = extractMarketFromAccount(account) || parseCampaignName(account).codeCountry
      const byMarket = accounts.filter((acc) => {
        const accMkt = extractMarketFromAccount(acc.name) || parseCampaignName(acc.name || '').codeCountry
        return accMkt && targetMkt && accMkt === targetMkt
      })
      if (byMarket.length > 0) {
        accounts = byMarket
      } else {
        accounts = accounts.filter((acc) => acc.name === account)
      }
    }
    const allAds = []

    for (const acc of accounts) {
      try {
        const insights = await fetchMetaDataAllPages(storedToken, `/${acc.id}/insights`, insightsParams)
        const ads = insights.data || []
        for (const a of ads) {
          const spend = parseFloat(a.spend || 0)
          let roas = null
          if (a.action_values && Array.isArray(a.action_values)) {
            const purchase = a.action_values.find(
              (av) =>
                av.action_type &&
                (av.action_type.includes('purchase') ||
                  av.action_type.includes('fb_pixel_purchase') ||
                  av.action_type === 'purchase')
            )
            if (purchase && purchase.value && spend > 0) {
              roas = Math.round((parseFloat(purchase.value) / spend) * 100) / 100
            }
          }
          allAds.push({
            adName: a.ad_name || a.ad_id || '-',
            adId: a.ad_id,
            spend,
            impressions: parseInt(a.impressions || 0, 10),
            clicks: parseInt(a.clicks || 0, 10),
            roas,
          })
        }
      } catch (e) {
        console.warn(`Skip account ${acc.name} for winners:`, e.message)
      }
    }

    allAds.sort((a, b) => b.spend - a.spend)
    const winners = allAds.map((ad, i) => {
      const parsed = parseAdName(ad.adName)
      return {
        rank: i + 1,
        adName: ad.adName,
        market: parsed.codeCountry || '-',
        product: parsed.productName || 'Other',
        format: parsed.format || '-',
        spend: ad.spend,
        impressions: ad.impressions,
        clicks: ad.clicks,
        roas: ad.roas ?? '-',
        ctr: ad.impressions > 0 ? Math.round((ad.clicks / ad.impressions) * 1000) / 10 : null,
      }
    })

    res.json({ winners })
  } catch (err) {
    console.error(err)
    res.status(err.status || 500).json({ error: err.message || 'Failed to fetch winners' })
  }
}

// Budgets campagnes
app.get('/api/campaigns/budgets', async (req, res) => {
  if (!hasDb()) return res.status(503).json({ error: 'Database not configured' })
  try {
    const dbBudgets = await import('./db/budgets.js')
    const list = await dbBudgets.listCampaignBudgets(req.query.account || null)
    res.json({ budgets: list })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// Campaign naming parser
app.get('/api/utils/parse-campaign', (req, res) => {
  const { name } = req.query
  if (!name) return res.status(400).json({ error: 'Campaign name required' })
  res.json(parseCampaignName(name))
})

// Handler erreurs global (réponse JSON pour /api)
app.use((err, req, res, next) => {
  if (res.headersSent) return next(err)
  console.error('[API error]', err)
  const msg = err?.message || err?.toString?.() || 'Erreur interne'
  if (req.path?.startsWith?.('/api') || req.url?.startsWith?.('/api')) {
    return res.status(500).json({ error: msg, hint: 'Vérifier les logs serveur.' })
  }
  next(err)
})

export default app
if (!process.env.VERCEL) {
  app.listen(PORT, () => {
    console.log(`API running at http://localhost:${PORT}`)
  })
}
