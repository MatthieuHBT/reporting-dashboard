const META_API_BASE = 'https://graph.facebook.com/v21.0'
const META_FETCH_TIMEOUT_MS = 60_000

async function fetchWithTimeout(url) {
  const controller = new AbortController()
  const t = setTimeout(() => controller.abort(), META_FETCH_TIMEOUT_MS)
  try {
    return await fetch(url, { signal: controller.signal })
  } finally {
    clearTimeout(t)
  }
}

export async function fetchMetaData(accessToken, path, params = {}) {
  const url = new URL(path.startsWith('http') ? path : `${META_API_BASE}${path}`)
  url.searchParams.set('access_token', accessToken)
  for (const [k, v] of Object.entries(params)) {
    if (v != null) url.searchParams.set(k, v)
  }

  const res = await fetchWithTimeout(url.toString())
  const json = await res.json()

  if (json.error) {
    const err = new Error(json.error.message || 'Meta API error')
    err.status = json.error.code === 190 ? 401 : (json.error.code || 500)
    throw err
  }
  return json
}

/** Fetch all pages (pour récupérer toutes les données) */
export async function fetchMetaDataAllPages(accessToken, path, params = {}) {
  const allData = []
  let nextUrl = null

  while (true) {
    const fetchUrl = nextUrl || (() => {
      const u = new URL(path.startsWith('http') ? path : `${META_API_BASE}${path}`)
      u.searchParams.set('access_token', accessToken)
      for (const [k, v] of Object.entries(params)) {
        if (v != null) u.searchParams.set(k, v)
      }
      return u.toString()
    })()

    const res = await fetchWithTimeout(fetchUrl)
    const json = await res.json()

    if (json.error) {
      const err = new Error(json.error.message || 'Meta API error')
      err.status = json.error.code === 190 ? 401 : (json.error.code || 500)
      throw err
    }

    const data = json.data || []
    allData.push(...data)

    nextUrl = json.paging?.next
    if (!nextUrl) break
  }

  return { data: allData }
}
