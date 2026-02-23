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

// Cache (mémoire) des ad accounts par workspace pour éviter d'appeler Meta à chaque refresh UI.
// Clé: workspaceId, Valeur: { token, ts, accounts: [{id,name}] }
const WORKSPACE_ACCOUNTS_CACHE_TTL_MS = 5 * 60 * 1000
const workspaceAccountsCache = new Map()

async function getWorkspaceMetaAccounts(workspaceId) {
  if (!hasDb() || !workspaceId) return null
  let token = null
  try {
    const { getMetaToken } = await import('./db/settings.js')
    token = await getMetaToken(workspaceId)
  } catch {
    return null
  }
  if (!token) return null

  const cached = workspaceAccountsCache.get(String(workspaceId))
  if (cached && cached.token === token && (Date.now() - cached.ts) < WORKSPACE_ACCOUNTS_CACHE_TTL_MS) {
    return cached.accounts || []
  }
  try {
    const data = await fetchMetaData(token, '/me/adaccounts', { fields: 'id,name', limit: 500 })
    const accounts = (data.data || [])
      .map((a) => ({ id: a.id ? String(a.id) : null, name: a.name ? String(a.name) : null }))
      .filter((a) => a.id || a.name)
    workspaceAccountsCache.set(String(workspaceId), { token, ts: Date.now(), accounts })
    return accounts
  } catch {
    return null
  }
}

/** Wrapper pour que les erreurs async soient passées au handler d'erreur (réponse toujours JSON pour /api) */
function asyncHandler(fn) {
  return (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next)
}

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

/** Enrichit une réponse spend avec les budgets Neon (si DB configurée) */
async function enrichSpendWithBudgets(payload, range, workspaceId) {
  if (!hasDb()) return
  try {
    const dbBudgets = await import('./db/budgets.js')
    const budgetByAccount = await dbBudgets.getBudgetsByAccount(workspaceId)
    const totalDailyBudgetAll = await dbBudgets.getTotalDailyBudget(workspaceId)
    const daysInRange = getDaysInRange(range?.since, range?.until)
    const byAccountList = (payload.byAccount || []).map((a) => {
      const key = a.accountName || a.accountId
      const dailyBudget = parseFloat(budgetByAccount[key] || 0)
      const budgetPeriod = Math.round(dailyBudget * daysInRange * 100) / 100
      return { ...a, dailyBudget, budgetPeriod, budget: budgetPeriod }
    })
    payload.byAccount = byAccountList
    payload.daysInRange = daysInRange
    payload.totalDailyBudget = Math.round((totalDailyBudgetAll || 0) * 100) / 100
    payload.totalBudgetPeriod = Math.round((totalDailyBudgetAll || 0) * daysInRange * 100) / 100
  } catch (e) {
    console.warn('enrichSpendWithBudgets:', e.message)
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
async function mergeAllAdAccounts(existingAccounts = [], workspaceId) {
  // En mode SaaS (DB), on utilise le token du workspace (évite mélange entre comptes).
  let token = null
  if (hasDb()) {
    try {
      const { getMetaToken } = await import('./db/settings.js')
      token = await getMetaToken(workspaceId)
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
const PORT = process.env.PORT || 3001

const corsOrigins = [
  'http://localhost:3002', 'http://localhost:3004', 'http://localhost:3005',
  'http://127.0.0.1:3002', 'http://127.0.0.1:3004', 'http://127.0.0.1:3005',
]
if (process.env.VERCEL_URL) {
  corsOrigins.push(`https://${process.env.VERCEL_URL}`, `https://www.${process.env.VERCEL_URL}`)
}
if (process.env.FRONTEND_URL) corsOrigins.push(process.env.FRONTEND_URL)
app.use(cors({
  origin: corsOrigins,
  methods: ['GET', 'POST', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Workspace-Id'],
  optionsSuccessStatus: 204,
}))
app.use(express.json())

// SaaS groundwork: workspace selector (header only, no enforcement yet)
app.use((req, _res, next) => {
  const ws = req.headers['x-workspace-id']
  req.workspaceId = typeof ws === 'string' && ws.trim() ? ws.trim() : null
  next()
})

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
app.post('/api/auth/db/login', asyncHandler(async (req, res) => {
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
    // SaaS: default workspace for user
    let workspaces = []
    try {
      const { ensureDefaultWorkspaceForUser, listWorkspacesForUser } = await import('./db/workspaces.js')
      await ensureDefaultWorkspaceForUser(user.id, user.name)
      workspaces = await listWorkspacesForUser(user.id)
    } catch (wsErr) {
      console.warn('[login] workspaces:', wsErr?.message)
      workspaces = []
    }
    const defaultWorkspaceId = workspaces?.[0]?.id || null
    const token = jwt.sign(
      { id: user.id, email: user.email, workspaceId: defaultWorkspaceId },
      JWT_SECRET,
      { expiresIn: '7d' }
    )
    res.json({
      token,
      user: { id: user.id, email: user.email, name: user.name, role: user.role, pages, workspaces },
    })
  } catch (err) {
    console.error('[login]', err)
    const hint = /does not exist|relation .* does not exist/i.test(String(err?.message || ''))
      ? 'Run: cd server && npm run db:migrate'
      : undefined
    res.status(500).json({ error: err.message || 'Login failed', ...(hint && { hint }) })
  }
}))

// Signup DB (Neon) : création user + retour token
app.post('/api/auth/db/signup', asyncHandler(async (req, res) => {
  if (!hasDb()) {
    return res.status(503).json({ error: 'Database not configured (DATABASE_URL)' })
  }
  try {
    const { findUserByEmail, createUser, getUserPages } = await import('./db/auth.js')
    const { sql } = await import('./db/index.js')
    const email = String(req.body?.email || '').trim()
    const password = String(req.body?.password || '')
    const name = String(req.body?.name || '').trim()

    if (!email || !password) {
      return res.status(400).json({ error: 'Email and password required' })
    }
    if (password.length < 8) {
      return res.status(400).json({ error: 'Password must be at least 8 characters' })
    }
    const existing = await findUserByEmail(email)
    if (existing) {
      return res.status(409).json({ error: 'Email already exists' })
    }

    const [{ count }] = await sql`SELECT COUNT(*)::int AS count FROM users`
    const isFirstUser = (count || 0) === 0
    const role = isFirstUser ? 'admin' : 'team'
    const defaultPages = role === 'admin' ? [] : ['general', 'spend', 'budget', 'winners', 'stock']
    const user = await createUser({
      email,
      password,
      name: name || email.split('@')[0],
      role,
      pages: defaultPages,
    })
    const pages = await getUserPages(user.id)

    // SaaS groundwork: attach user to a default workspace (backward-compatible if not migrated)
    let workspaces = []
    try {
      const { ensureDefaultWorkspaceForUser, listWorkspacesForUser } = await import('./db/workspaces.js')
      await ensureDefaultWorkspaceForUser(user.id, user.name)
      workspaces = await listWorkspacesForUser(user.id)
    } catch {
      workspaces = []
    }
    const defaultWorkspaceId = workspaces?.[0]?.id || null

    const token = jwt.sign(
      { id: user.id, email: user.email, workspaceId: defaultWorkspaceId },
      JWT_SECRET,
      { expiresIn: '7d' }
    )
    res.status(201).json({
      token,
      user: { id: user.id, email: user.email, name: user.name, role: user.role, pages, workspaces },
    })
  } catch (err) {
    console.error(err)
    const hint = /does not exist|relation .* does not exist/i.test(String(err?.message || ''))
      ? 'Run migrations: cd server && npm run db:migrate'
      : undefined
    res.status(500).json({ error: err.message || 'Signup failed', ...(hint && { hint }) })
  }
}))

async function requireDbUser(req, res, next) {
  const auth = req.headers.authorization
  const token = auth?.startsWith('Bearer ') ? auth.slice(7) : null
  if (!token) {
    return res.status(401).json({ error: 'Authentication required' })
  }
  try {
    const payload = jwt.verify(token, JWT_SECRET)
    req.user = payload
    // Workspace: header > JWT claim > default membership
    const headerWs = req.headers['x-workspace-id']
    const explicitWs = typeof headerWs === 'string' && headerWs.trim() ? headerWs.trim() : null
    const jwtWs = payload?.workspaceId ? String(payload.workspaceId) : null
    let candidateWs = explicitWs || jwtWs || null

    // Sécurité multi-tenant: si un workspaceId est fourni, vérifier la membership.
    // Sinon un user pourrait réutiliser un ancien X-Workspace-Id (localStorage) et voir des données d'un autre compte.
    if (candidateWs && hasDb()) {
      try {
        const { sql } = await import('./db/index.js')
        const isMember = async (wsId) => {
          const rows = await sql`
            SELECT 1
            FROM workspace_members
            WHERE workspace_id = ${String(wsId)}
              AND user_id = ${String(payload.id)}
            LIMIT 1
          `
          return rows?.length > 0
        }

        if (!(await isMember(candidateWs))) {
          // Si le header est invalide, tenter le workspace du JWT; sinon fallback.
          if (explicitWs && jwtWs && explicitWs !== jwtWs && (await isMember(jwtWs))) {
            candidateWs = jwtWs
          } else {
            candidateWs = null
          }
        }
      } catch {
        // Si la DB n'a pas encore les tables SaaS, on conserve le comportement existant.
      }
    }

    req.workspaceId = candidateWs
    if (!req.workspaceId && hasDb()) {
      try {
        const { findUserByEmail } = await import('./db/auth.js')
        const { ensureDefaultWorkspaceForUser } = await import('./db/workspaces.js')
        const user = await findUserByEmail(req.user.email)
        if (user) {
          const ws = await ensureDefaultWorkspaceForUser(user.id, user.name)
          req.workspaceId = ws?.id ? String(ws.id) : null
        }
      } catch {}
    }
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
    let workspaces = []
    try {
      const { listWorkspacesForUser } = await import('./db/workspaces.js')
      workspaces = await listWorkspacesForUser(user.id)
    } catch {}
    res.json({ user: { id: user.id, email: user.email, name: user.name, role: user.role, pages, workspaces, workspaceId: req.workspaceId || req.user?.workspaceId || null } })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// Workspace feature masked: switch disabled
app.post('/api/auth/switch-workspace', (_req, res) => res.status(404).json({ error: 'Not found' }))

// Workspace feature masked: list/create disabled
app.get('/api/workspaces', (_req, res) => res.status(404).json({ error: 'Not found' }))
app.post('/api/workspaces', (_req, res) => res.status(404).json({ error: 'Not found' }))

// Workspace members (current workspace from X-Workspace-Id)
app.get('/api/workspace/members', requireDbUser, async (req, res) => {
  if (!hasDb()) return res.status(503).json({ error: 'Database not configured' })
  if (!req.workspaceId) return res.status(400).json({ error: 'Select a workspace first' })
  try {
    const { listWorkspaceMembers } = await import('./db/workspaces.js')
    const members = await listWorkspaceMembers(req.workspaceId)
    res.json({ members })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

app.post('/api/workspace/members', requireDbUser, requireWorkspaceOwner, async (req, res) => {
  if (!hasDb()) return res.status(503).json({ error: 'Database not configured' })
  if (!req.workspaceId) return res.status(400).json({ error: 'Select a workspace first' })
  try {
    const { findUserByEmail } = await import('./db/auth.js')
    const { addWorkspaceMember, getWorkspaceRole } = await import('./db/workspaces.js')
    const email = String(req.body?.email || '').trim().toLowerCase()
    const role = (req.body?.role === 'admin' || req.body?.role === 'owner') ? req.body.role : 'member'
    if (!email) return res.status(400).json({ error: 'Email required' })
    const user = await findUserByEmail(email)
    if (!user) return res.status(404).json({ error: 'User not found. They must sign up first.' })
    const existing = await getWorkspaceRole(req.workspaceId, user.id)
    if (existing) return res.status(400).json({ error: 'User is already a member of this workspace' })
    await addWorkspaceMember(req.workspaceId, user.id, role)
    res.status(201).json({ success: true, user: { id: user.id, email: user.email, name: user.name, role } })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

app.delete('/api/workspace/members/:userId', requireDbUser, requireWorkspaceOwner, async (req, res) => {
  if (!hasDb()) return res.status(503).json({ error: 'Database not configured' })
  if (!req.workspaceId) return res.status(400).json({ error: 'Select a workspace first' })
  try {
    const { removeWorkspaceMember } = await import('./db/workspaces.js')
    const userId = String(req.params.userId)
    await removeWorkspaceMember(req.workspaceId, userId)
    res.json({ success: true })
  } catch (err) {
    if (err.message?.includes('last owner')) return res.status(400).json({ error: err.message })
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

async function requireWorkspaceOwner(req, res, next) {
  if (!hasDb()) return res.status(503).json({ error: 'Database not configured' })
  if (!req.workspaceId) return res.status(400).json({ error: 'workspaceId required' })
  try {
    const { findUserByEmail } = await import('./db/auth.js')
    const user = await findUserByEmail(req.user.email)
    if (!user) return res.status(401).json({ error: 'User not found' })
    if (user.role === 'admin') return next()

    const { getWorkspaceRole } = await import('./db/workspaces.js')
    const role = await getWorkspaceRole(req.workspaceId, user.id)
    if (role !== 'owner' && role !== 'admin') {
      return res.status(403).json({ error: 'Workspace owner required' })
    }
    next()
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
}

// Settings: Meta token + onboarding (first sync done)
app.get('/api/settings/meta-token', requireDbUser, async (req, res) => {
  if (!hasDb()) return res.status(503).json({ error: 'Database not configured' })
  try {
    const { getMetaToken } = await import('./db/settings.js')
    const token = await getMetaToken(req.workspaceId)
    let firstSyncDone = false
    if (req.workspaceId) {
      const { hasSuccessfulSync } = await import('./db/spend.js')
      firstSyncDone = await hasSuccessfulSync(req.workspaceId)
    }
    res.json({ configured: !!token, firstSyncDone })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

app.post('/api/settings/meta-token', requireDbUser, requireWorkspaceOwner, async (req, res) => {
  if (!hasDb()) return res.status(503).json({ error: 'Database not configured' })
  try {
    const { setMetaToken } = await import('./db/settings.js')
    const token = (req.body?.token || '').trim() || null
    await setMetaToken(req.workspaceId, token)
    res.json({ success: true, configured: !!token })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// Test Meta token (admin): vérifie que le token fonctionne avec l'API Meta
app.post('/api/settings/meta-token/test', requireDbUser, requireWorkspaceOwner, async (req, res) => {
  // SaaS: test uniquement le token stocké en BDD pour ce workspace
  let metaToken = null
  try {
    const { getMetaToken } = await import('./db/settings.js')
    metaToken = await getMetaToken(req.workspaceId)
  } catch {}
  if (!metaToken) {
    return res.status(400).json({ error: 'No Meta token configured for this workspace. Set one in Settings.' })
  }
  try {
    const data = await fetchMetaData(metaToken, '/me/adaccounts', { fields: 'id,name', limit: 1 })
    const count = (data.data || []).length
    res.json({ ok: true, message: `Token is valid — ${count} ad account(s) accessible.`, accountsCount: count })
  } catch (err) {
    const is190 = err.status === 401
    res.status(400).json({
      error: err.message || 'Meta connection failed',
      hint: is190
        ? 'Token is expired or invalid. Generate a new token in Graph API Explorer (ads_management, ads_read, business_management).'
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
    const normalizedRole = role || 'team'
    const defaultPages = normalizedRole === 'admin' ? [] : ['general', 'spend', 'budget', 'winners', 'stock']
    const user = await createUser({
      email: email.trim(),
      password,
      name: name.trim(),
      role: normalizedRole,
      pages: Array.isArray(pages) ? pages : defaultPages,
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
  console.log('[POST /api/refresh] Début sync', {
    hasDb: hasDb(),
    hasEnvToken: !!process.env.META_ACCESS_TOKEN,
    hasStoredToken: !!storedToken,
    query: req.query,
    bodyKeys: Object.keys(req.body || {}),
  })
  
  // SaaS: utiliser le token du workspace (évite mélange entre comptes).
  // Optionnellement, un token peut être passé dans le body pour un run ponctuel.
  let metaToken = null
  try {
    const { getMetaToken } = await import('./db/settings.js')
    metaToken = await getMetaToken(req.workspaceId)
    console.log('[POST /api/refresh] Token récupéré depuis BDD:', !!metaToken)
  } catch (e) {
    console.warn('[POST /api/refresh] Erreur récupération token BDD:', e.message)
  }
  if (!metaToken) {
    metaToken = (req.body?.accessToken || '').trim() || null
  }
  
  if (!metaToken) {
    console.error('[POST /api/refresh] Aucun token Meta trouvé')
    return res.status(400).json({ error: 'Configure your Meta token in Settings' })
  }
  
  if (!hasDb()) {
    console.error('[POST /api/refresh] Database not configured')
    return res.status(503).json({ error: 'Database not configured (DATABASE_URL)' })
  }
  
  try {
    const forceFull = req.query.full === '1' || req.body?.full === true
    const skipAds = req.query.skipAds === '1' || req.body?.skipAds === true
    const skipBudgets = req.query.skipBudgets === '1' || req.body?.skipBudgets === true
    const winnersOnly = req.query.winnersOnly === '1' || req.body?.winnersOnly === true
    const winnersDays = req.query.days ? parseInt(req.query.days, 10) : null
    const campaignDays = req.query.campaignDays ? parseInt(req.query.campaignDays, 10) : null
    const accounts = Array.isArray(req.body?.accounts) ? req.body.accounts.filter(Boolean) : null
    const winnersFilters = req.body?.winnersFilters && typeof req.body.winnersFilters === 'object' ? req.body.winnersFilters : null
    
    console.log('[POST /api/refresh] Options:', { forceFull, skipAds, skipBudgets, winnersOnly, winnersDays, campaignDays, accountsCount: accounts?.length || 0, hasWinnersFilters: !!winnersFilters })
    
    const { runFullSync } = await import('./services/syncToDb.js')
    console.log('[POST /api/refresh] Lancement runFullSync...')
    const result = await runFullSync(metaToken, req.workspaceId, forceFull, skipAds, skipBudgets, winnersOnly, winnersDays, campaignDays, accounts, winnersFilters)
    console.log('[POST /api/refresh] Sync réussie:', {
      campaignsCount: result.campaignsCount,
      incremental: result.incremental,
      range: result.range,
    })
    res.json(result)
  } catch (err) {
    const msg = err?.message || err?.toString?.() || 'Refresh failed'
    console.error('[POST /api/refresh] ERREUR:', {
      message: msg,
      status: err?.status,
      code: err?.code,
      stack: err?.stack?.split('\n').slice(0, 5).join('\n'),
    })
    
    let hint = null
    if (msg?.includes('timeout') || err?.code === 'ETIMEDOUT' || err?.code === 'ECONNRESET') {
      hint = 'Sync took too long (timeout). Try a quick sync or Winners-only.'
    } else if (err?.status === 401 || /invalid|expired|190|access token/i.test(msg)) {
      hint = 'Meta token is expired or invalid. Go to Settings → Test token, then generate a new token in Graph API Explorer.'
    } else if (err?.code === 'ENOTFOUND' || err?.code === 'ECONNREFUSED') {
      hint = 'Network error. Check your internet connection and Meta API availability.'
    }
    
    if (!res.headersSent) {
      res.status(500).json({ error: msg, hint })
    }
  }
})

// Reset (purge) données du client courant puis resync Meta (owner uniquement)
const resetAndSyncHandler = asyncHandler(async (req, res) => {
  if (!hasDb()) return res.status(503).json({ error: 'Database not configured' })
  if (!req.workspaceId) return res.status(400).json({ error: 'workspaceId required' })

  const body = req.body || {}
  const requestedDays = body?.campaignDays != null ? Number(body.campaignDays) : 30
  const campaignDays = Math.min(Math.max(1, isNaN(requestedDays) ? 30 : requestedDays), 90)
  const includeWinners = body?.includeWinners === true
  const skipAds = !includeWinners

  // Petit "ensure" pour éviter les erreurs ON CONFLICT / colonne manquante en prod.
  try {
    const { sql } = await import('./db/index.js')
    // campaign_budgets peut exister sans workspace_id (ancienne version) → ajouter + supprimer legacy NULL pour éviter conflits
    await sql`ALTER TABLE campaign_budgets ADD COLUMN IF NOT EXISTS workspace_id UUID`.catch(() => {})
    await sql`DELETE FROM campaign_budgets WHERE workspace_id IS NULL`.catch(() => {})
    await sql`ALTER TABLE settings ADD COLUMN IF NOT EXISTS workspace_id UUID`.catch(() => {})
  } catch (_) {}

  const { deleteWorkspaceSpendData } = await import('./db/spend.js')
  const { deleteWorkspaceBudgets } = await import('./db/budgets.js')
  await deleteWorkspaceBudgets(req.workspaceId)
  await deleteWorkspaceSpendData(req.workspaceId)

  // Invalider le cache accounts (si présent)
  try { workspaceAccountsCache.delete(String(req.workspaceId)) } catch {}

  const { getMetaToken } = await import('./db/settings.js')
  const metaToken = await getMetaToken(req.workspaceId)
  if (!metaToken) return res.status(400).json({ error: 'Configure your Meta token in Settings first' })

  const { runFullSync } = await import('./services/syncToDb.js')
  const result = await runFullSync(metaToken, req.workspaceId, false, skipAds, false, false, null, campaignDays, null, null)

  return res.json({ ok: true, workspaceId: req.workspaceId, campaignDays, includeWinners, ...result })
})

// Backward-compat path + preferred path (workspace hidden)
app.post('/api/workspace/reset-and-sync', requireDbUser, requireWorkspaceOwner, resetAndSyncHandler)
app.post('/api/client/reset-and-sync', requireDbUser, requireWorkspaceOwner, resetAndSyncHandler)

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
app.get('/api/reports/spend-today', requireDbUser, async (req, res) => {
  if (!hasDb()) return res.status(503).json({ error: 'Database not configured' })
  if (!req.workspaceId) {
    return res.status(400).json({ error: 'Workspace required', campaigns: [], totalSpendToday: 0, byAccount: {} })
  }
  // SaaS: token du workspace uniquement (pas de fallback .env, sinon mélange entre comptes)
  let metaToken = null
  try {
    const { getMetaToken } = await import('./db/settings.js')
    metaToken = await getMetaToken(req.workspaceId)
  } catch {}
  if (!metaToken) {
    return res.status(400).json({ error: 'Configure your Meta token in Settings' })
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
app.get('/api/reports/spend', requireDbUser, asyncHandler(async (req, res) => {
  const { datePreset, since, until, account } = req.query
  const range = getDateRange(datePreset, since, until)
  const accountName = account || null

  if (hasDb()) {
    if (!req.workspaceId) {
      return res.status(400).json({
        error: 'Workspace required',
        campaigns: [],
        byAccount: [],
        byProduct: [],
        byMarket: [],
        totalSpend: 0,
        accounts: [],
        daysInRange: 0,
        totalDailyBudget: 0,
        totalBudgetPeriod: 0,
        lastSyncAt: null,
      })
    }
    try {
      const dbSpend = await import('./db/spend.js')
      let filteredCampaigns = await dbSpend.getCampaigns(range?.since, range?.until, accountName, req.workspaceId)

      // Sécurité: ne compter que les ad accounts accessibles par le token Meta du workspace.
      // Utile si la BDD contient de l'historique "mélangé" (ex. anciennes lignes backfillées dans un workspace legacy).
      const metaAccounts = await getWorkspaceMetaAccounts(req.workspaceId)
      if (Array.isArray(metaAccounts) && metaAccounts.length) {
        const allowedIds = new Set(metaAccounts.map((a) => a.id).filter(Boolean))
        const allowedNames = new Set(metaAccounts.map((a) => a.name).filter(Boolean))
        filteredCampaigns = filteredCampaigns.filter((c) => {
          const idOk = c.accountId && allowedIds.has(String(c.accountId))
          const nameOk = c.accountName && allowedNames.has(String(c.accountName))
          return idOk || nameOk
        })
      }

      // Liste des accounts pour le dropdown (priorité au token Meta du workspace).
      let allAccounts = []
      if (Array.isArray(metaAccounts) && metaAccounts.length) {
        allAccounts = [...new Set(metaAccounts.map((a) => a.name).filter(Boolean))].sort()
      } else {
        const fromDb = await dbSpend.getDistinctAccounts(req.workspaceId)
        allAccounts = await mergeAllAdAccounts(fromDb, req.workspaceId)
      }
      let lastSyncAt = null
      try {
        const latest = await dbSpend.getLatestSyncRun(req.workspaceId)
        lastSyncAt = latest?.synced_at ? new Date(latest.synced_at).toISOString() : null
      } catch (_) {}
      let budgetByAccount = {}
      try {
        const dbBudgets = await import('./db/budgets.js')
        budgetByAccount = await dbBudgets.getBudgetsByAccount(req.workspaceId)
      } catch (_) {}
      const byAccount = {}
      const byProduct = {}
      const byMarket = {}
      for (const r of filteredCampaigns) {
        const accKey = r.accountName || r.accountId
        const marketFromAccount = extractMarketFromAccount(r.accountName || '')
        const mktKey = (r.codeCountry && r.codeCountry.trim()) || marketFromAccount || 'Unknown'
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
      let totalDailyBudgetAll = 0
      try {
        const dbBudgets = await import('./db/budgets.js')
        totalDailyBudgetAll = await dbBudgets.getTotalDailyBudget(req.workspaceId)
      } catch (_) {}
      const totalBudgetPeriod = Math.round((totalDailyBudgetAll || 0) * daysInRange * 100) / 100
      return res.json({
        campaigns: filteredCampaigns,
        byAccount: byAccountList,
        byProduct: Object.values(byProduct),
        byMarket: Object.values(byMarket),
        totalSpend: filteredCampaigns.reduce((s, r) => s + (r.spend || 0), 0),
        accounts: allAccounts,
        daysInRange,
        totalDailyBudget: Math.round((totalDailyBudgetAll || 0) * 100) / 100,
        totalBudgetPeriod,
        lastSyncAt,
      })
    } catch (err) {
      console.error('DB spend error:', err)
      return res.status(500).json({ error: 'DB spend error', hint: 'Check server logs.' })
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
      const allAccounts = await mergeAllAdAccounts(fromCampaigns, req.workspaceId)
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
      const payload = {
        campaigns: filteredCampaigns,
        byAccount: Object.values(byAccount),
        byProduct: Object.values(byProduct),
        byMarket: Object.values(byMarket),
        totalSpend: filteredCampaigns.reduce((s, r) => s + (r.spend || 0), 0),
        accounts: allAccounts,
      }
      await enrichSpendWithBudgets(payload, range)
      return res.json(payload)
    } catch (e) {
      return res.status(500).json({ error: 'Failed to read spend data' })
    }
  }
  // Fallback: appels API (si token dispo)
  if (!storedToken) {
    return res.status(503).json({ error: 'Run npm run sync first to fetch data, or connect Meta token' })
  }
  requireAuth(req, res, () => fetchSpendFromApi(req, res))
}));

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
    const range = getDateRange(req.query.datePreset, req.query.since, req.query.until)
    const payload = {
      campaigns: filtered,
      byAccount: Object.values(byAccount),
      byProduct: Object.values(byProduct),
      byMarket: Object.values(byMarket),
      accounts: allAccountNames,
      totalSpend: filtered.reduce((s, r) => s + r.spend, 0)
    }
    await enrichSpendWithBudgets(payload, range, req.workspaceId)
    res.json(payload)
  } catch (err) {
    console.error(err)
    res.status(err.status || 500).json({ error: err.message || 'Failed to fetch spend' })
  }
}

// Winners: BDD (ads_raw) > data/winners.json > API Meta live
app.get('/api/reports/winners', requireDbUser, async (req, res) => {
  const { datePreset, since, until, account } = req.query
  const range = getDateRange(datePreset, since, until)

  if (hasDb()) {
    if (!req.workspaceId) {
      return res.status(400).json({ error: 'Workspace required', winners: [] })
    }
    try {
      const dbSpend = await import('./db/spend.js')
      const rows = await dbSpend.getAdsRaw(range?.since, range?.until, account || null, req.workspaceId)
      const byAd = {}
      for (const r of rows) {
        const key = r.adId || r.adName
        if (!byAd[key]) {
          byAd[key] = { adName: r.adName, adId: r.adId, spend: 0, impressions: 0, clicks: 0, purchases: 0, purchaseValue: 0 }
        }
        byAd[key].spend += r.spend || 0
        byAd[key].impressions += r.impressions || 0
        byAd[key].clicks += r.clicks || 0
        byAd[key].purchases += r.purchaseCount || 0
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
            purchases: ad.purchases || 0,
            purchaseValue: Math.round((ad.purchaseValue || 0) * 100) / 100,
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
      return res.status(500).json({ error: 'DB winners error', hint: 'Check server logs.' })
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
            purchases: 0,
            purchaseValue: 0,
          }
        }
        byAd[key].spend += r.spend || 0
        byAd[key].impressions += r.impressions || 0
        byAd[key].clicks += r.clicks || 0
        byAd[key].purchases += r.purchaseCount || 0
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
            purchases: ad.purchases || 0,
            purchaseValue: Math.round((ad.purchaseValue || 0) * 100) / 100,
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
    fields: 'ad_name,ad_id,spend,impressions,clicks,actions,action_values',
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
          let purchaseValue = 0
          let purchases = 0
          if (a.actions && Array.isArray(a.actions)) {
            const purchase = a.actions.find(
              (av) =>
                av.action_type &&
                (av.action_type.includes('purchase') ||
                  av.action_type.includes('fb_pixel_purchase') ||
                  av.action_type === 'purchase')
            )
            if (purchase?.value != null) purchases = parseInt(purchase.value, 10) || 0
          }
          if (a.action_values && Array.isArray(a.action_values)) {
            const purchase = a.action_values.find(
              (av) =>
                av.action_type &&
                (av.action_type.includes('purchase') ||
                  av.action_type.includes('fb_pixel_purchase') ||
                  av.action_type === 'purchase')
            )
            if (purchase && purchase.value && spend > 0) {
              purchaseValue = parseFloat(purchase.value) || 0
              roas = Math.round((purchaseValue / spend) * 100) / 100
            }
          }
          allAds.push({
            adName: a.ad_name || a.ad_id || '-',
            adId: a.ad_id,
            spend,
            impressions: parseInt(a.impressions || 0, 10),
            clicks: parseInt(a.clicks || 0, 10),
            purchases,
            purchaseValue,
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
        purchases: ad.purchases || 0,
        purchaseValue: Math.round((ad.purchaseValue || 0) * 100) / 100,
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
app.get('/api/campaigns/budgets', requireDbUser, async (req, res) => {
  console.log('[GET /api/campaigns/budgets]', { account: req.query.account, hasDb: hasDb() })
  if (!hasDb()) return res.status(503).json({ error: 'Database not configured' })
  if (!req.workspaceId) return res.status(400).json({ error: 'Workspace required', budgets: [] })
  try {
    const dbBudgets = await import('./db/budgets.js')
    const list = await dbBudgets.listCampaignBudgets(req.workspaceId, req.query.account || null)
    console.log('[GET /api/campaigns/budgets] OK:', list.length, 'budgets')
    res.json({ budgets: list })
  } catch (err) {
    console.error('[GET /api/campaigns/budgets] Error:', err)
    res.status(500).json({ error: err.message })
  }
})

// Campaign naming parser
app.get('/api/utils/parse-campaign', (req, res) => {
  const { name } = req.query
  if (!name) return res.status(400).json({ error: 'Campaign name required' })
  res.json(parseCampaignName(name))
})

// Handler erreurs global (réponse JSON pour /api — évite la page HTML 500)
app.use((err, req, res, next) => {
  if (res.headersSent) return next(err)
  console.error('[API error]', err)
  const msg = err?.message || err?.toString?.() || 'Internal error'
  const hint = /does not exist|column .* does not exist/i.test(msg)
    ? 'Database schema may be outdated. Run: cd server && npm run db:migrate (or db:fix-budgets-pk if needed).'
    : 'Check server logs.'
  res.setHeader('Content-Type', 'application/json')
  res.status(500).json({ error: msg, hint })
})

export default app
if (!process.env.VERCEL) {
  let server = null
  const start = () => {
    server = app.listen(PORT, () => {
      console.log(`Dashboard API: http://localhost:${PORT}`)
      console.log(`Front (Vite) doit proxy /api vers ce port (défaut 3001). Si tu es sur :3005, le proxy cible :${PORT}.`)
    })
    server.on('error', (err) => {
      if (err?.code === 'EADDRINUSE') {
        console.warn(`[API] Port ${PORT} déjà utilisé. Retry dans 500ms...`)
        setTimeout(() => start(), 500)
        return
      }
      console.error('[API] Server error:', err)
      process.exit(1)
    })
  }
  const shutdown = (sig) => {
    if (!server) return process.exit(0)
    console.log(`[API] Arrêt (${sig})...`)
    server.close(() => process.exit(0))
    setTimeout(() => process.exit(0), 1000).unref()
  }
  process.on('SIGTERM', () => shutdown('SIGTERM'))
  process.on('SIGINT', () => shutdown('SIGINT'))
  start()
}
