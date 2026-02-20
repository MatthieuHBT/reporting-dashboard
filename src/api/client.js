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
    const msg = e.name === 'AbortError' ? `Requête expirée (${timeoutMs / 1000}s). Vérifie VITE_API_URL et la connexion.` : (e.message || 'Erreur réseau')
    throw new Error(`${msg} — URL: ${url}`)
  }
  clearTimeout(timeoutId)
  const ct = res.headers.get('content-type') || ''
  const data = await res.json().catch(() => ({}))
  if (!ct.includes('application/json') && res.ok) {
    throw new Error(`API a renvoyé du HTML au lieu de JSON — VITE_API_URL configurée ? (${url})`)
  }
  if (!res.ok) {
    const ct = res.headers.get('content-type') || ''
    const msg = data?.error || data?.message || (res.status === 401 ? 'Session expirée' : res.status === 503 ? 'Service indisponible' : `Erreur ${res.status}`)
    const full = data?.hint ? `${msg} — ${data.hint}` : msg
    if (!ct.includes('application/json') && res.status >= 500) {
      throw new Error(`${full} (réponse non-JSON — vérifier les logs serveur)`)
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
      me: () => request('/auth/db/me'),
    },
  },
  refresh: (accessToken, opts = {}) => {
    const params = new URLSearchParams()
    if (opts.full) params.set('full', '1')
    if (opts.skipAds) params.set('skipAds', '1')
    if (opts.winnersOnly) params.set('winnersOnly', '1')
    if (opts.days) params.set('days', String(opts.days))
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
