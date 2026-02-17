const META_API_BASE = 'https://graph.facebook.com/v21.0'

export async function fetchMetaData(accessToken, path, params = {}) {
  const url = new URL(path.startsWith('http') ? path : `${META_API_BASE}${path}`)
  url.searchParams.set('access_token', accessToken)
  for (const [k, v] of Object.entries(params)) {
    if (v != null) url.searchParams.set(k, v)
  }

  const res = await fetch(url.toString())
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

    const res = await fetch(fetchUrl)
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
