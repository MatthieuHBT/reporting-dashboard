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

async function request(path, options = {}) {
  const token = getStoredToken()
  const headers = { 'Content-Type': 'application/json', ...options.headers }
  if (token) headers['Authorization'] = `Bearer ${token}`
  let res
  const url = `${API_BASE}${path}`
  try {
    res = await fetch(url, { ...options, headers })
  } catch (e) {
    const msg = e.message || 'Erreur réseau'
    throw new Error(`${msg} — URL: ${url}`)
  }
  const ct = res.headers.get('content-type') || ''
  const data = await res.json().catch(() => ({}))
  if (!ct.includes('application/json') && res.ok) {
    throw new Error(`API a renvoyé du HTML au lieu de JSON — VITE_API_URL configurée ? (${url})`)
  }
  if (!res.ok) {
    const msg = data.error || data.message || (res.status === 401 ? 'Session expirée' : res.status === 503 ? 'Service indisponible' : `Erreur ${res.status}`)
    throw new Error(msg)
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
    const qs = params.toString()
    return request(`/refresh${qs ? '?' + qs : ''}`, {
      method: 'POST',
      body: JSON.stringify({ accessToken: accessToken || undefined }),
    })
  },
  settings: {
    metaToken: {
      get: () => request('/settings/meta-token'),
      set: (token) => request('/settings/meta-token', { method: 'POST', body: JSON.stringify({ token: token || '' }) }),
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
    winners: (params = {}) => {
      const q = new URLSearchParams(params).toString()
      return request(`/reports/winners${q ? `?${q}` : ''}`)
    },
  },
}
