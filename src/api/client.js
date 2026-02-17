const API_BASE = '/api'
const AUTH_KEY = 'vp_auth_token'

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
  const res = await fetch(`${API_BASE}${path}`, { ...options, headers })
  const data = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`)
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
