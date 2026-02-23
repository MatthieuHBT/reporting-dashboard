const _api = import.meta.env.VITE_API_URL?.replace(/\/$/, '') || ''
const API_BASE = _api ? (_api.endsWith('/api') ? _api : _api + '/api') : '/api'
const AUTH_KEY = 'vp_auth_token'

export function getApiBase() {
  return API_BASE
}

export function getStoredToken() {
  return localStorage.getItem(AUTH_KEY)
}

export function setStoredToken(token) {
  if (token) localStorage.setItem(AUTH_KEY, token)
  else localStorage.removeItem(AUTH_KEY)
}

const FETCH_TIMEOUT = 30000 // 30s par défaut
const SYNC_TIMEOUT = 300000 // 5 min pour la synchro Meta

async function request(path, options = {}) {
  const { timeout: timeoutOpt, ...fetchOptions } = options
  const token = getStoredToken()
  const headers = { 'Content-Type': 'application/json', ...fetchOptions.headers }
  if (token) headers['Authorization'] = `Bearer ${token}`
  const url = `${API_BASE}${path}`
  const timeoutMs = timeoutOpt ?? FETCH_TIMEOUT
  const controller = new AbortController()
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs)
  let res
  try {
    res = await fetch(url, { ...fetchOptions, headers, signal: controller.signal })
  } catch (e) {
    clearTimeout(timeoutId)
    const msg = e.name === 'AbortError'
      ? `Request timed out (${timeoutMs / 1000}s). Check VITE_API_URL and your connection.`
      : (e.message || 'Network error')
    throw new Error(`${msg} — URL: ${url}`)
  }
  clearTimeout(timeoutId)
  const ct = res.headers.get('content-type') || ''
  const data = await res.json().catch(() => ({}))
  if (!ct.includes('application/json') && res.ok) {
    throw new Error(`API returned HTML instead of JSON — check VITE_API_URL (${url})`)
  }
  if (!res.ok) {
    const ct = res.headers.get('content-type') || ''
    const msg = data?.error || data?.message || (res.status === 401 ? 'Session expired' : res.status === 503 ? 'Service unavailable' : `Error ${res.status}`)
    const full = data?.hint ? `${msg} — ${data.hint}` : msg
    if (!ct.includes('application/json') && res.status >= 500) {
      throw new Error(`${full} (non-JSON response — check server logs)`)
    }
    throw new Error(full)
  }
  return data
}

export const api = {
  health: () => request('/health'),
  auth: {
    status: () => request('/auth/status'),
    login: (accessToken) => request('/auth/login', { method: 'POST', body: JSON.stringify({ accessToken }) }),
    logout: () => request('/auth/logout', { method: 'POST' }),
    db: {
      login: (email, password) => request('/auth/db/login', { method: 'POST', body: JSON.stringify({ email, password }) }),
      signup: (email, password, name) => request('/auth/db/signup', { method: 'POST', body: JSON.stringify({ email, password, name }) }),
      me: () => request('/auth/db/me'),
      switchWorkspace: (workspaceId) => request('/auth/switch-workspace', { method: 'POST', body: JSON.stringify({ workspaceId }) }),
    },
  },
  refresh: (accessToken, opts = {}) => {
    const params = new URLSearchParams()
    if (opts.full) params.set('full', '1')
    if (opts.skipAds) params.set('skipAds', '1')
    if (opts.skipBudgets) params.set('skipBudgets', '1')
    if (opts.winnersOnly) params.set('winnersOnly', '1')
    if (opts.days) params.set('days', String(opts.days))
    if (opts.campaignDays) params.set('campaignDays', String(opts.campaignDays))
    const qs = params.toString()
    return request(`/refresh${qs ? '?' + qs : ''}`, {
      method: 'POST',
      body: JSON.stringify({
        accessToken: accessToken || undefined,
        accounts: Array.isArray(opts.accounts) && opts.accounts.length ? opts.accounts : undefined,
        winnersFilters: opts.winnersFilters || undefined,
      }),
      timeout: SYNC_TIMEOUT,
    })
  },
  settings: {
    metaToken: {
      get: () => request('/settings/meta-token'),
      set: (token) => request('/settings/meta-token', { method: 'POST', body: JSON.stringify({ token: token || '' }) }),
      test: () => request('/settings/meta-token/test', { method: 'POST' }),
    },
  },
  workspaces: {
    list: () => request('/workspaces'),
    create: (name) => request('/workspaces', { method: 'POST', body: JSON.stringify({ name: String(name || '').trim() }) }),
    resetAndSync: (opts = {}) => request('/workspace/reset-and-sync', { method: 'POST', body: JSON.stringify(opts || {}), timeout: SYNC_TIMEOUT }),
    members: {
      list: () => request('/workspace/members'),
      add: (email, role) => request('/workspace/members', { method: 'POST', body: JSON.stringify({ email: String(email || '').trim(), role: role || 'member' }) }),
      remove: (userId) => request(`/workspace/members/${encodeURIComponent(userId)}`, { method: 'DELETE' }),
    },
  },
  users: {
    list: () => request('/users'),
    create: (user) => request('/users', { method: 'POST', body: JSON.stringify(user) }),
    updatePages: (id, pages) => request(`/users/${String(id)}/pages`, { method: 'PATCH', body: JSON.stringify({ pages }) }),
    delete: (id) => request(`/users/${id}`, { method: 'DELETE' }),
  },
  reports: {
    spend: (params = {}) => {
      const q = new URLSearchParams(params).toString()
      return request(`/reports/spend${q ? `?${q}` : ''}`)
    },
    spendToday: () => request('/reports/spend-today'),
    winners: (params = {}) => {
      const q = new URLSearchParams(params).toString()
      return request(`/reports/winners${q ? `?${q}` : ''}`)
    },
  },
  campaigns: {
    budgets: (params = {}) => {
      const q = params.account ? `?account=${encodeURIComponent(params.account)}` : ''
      const path = `/campaigns/budgets${q}`
      console.log('[api.campaigns.budgets] Calling:', API_BASE + path)
      return request(path)
    },
  },
}
