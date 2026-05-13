const base = '/api'

async function request(path, options = {}) {
  const url = `${base}${path}`
  console.log(`[API] ${options.method || 'GET'} ${url}`)
  try {
    const res = await fetch(url, {
      headers: { 'Content-Type': 'application/json', ...options.headers },
      ...options,
    })
    const text = await res.text()
    let json = {}
    try { json = JSON.parse(text) } catch (e) {
      console.error(`[API] ${url} — response is not JSON:`, text.slice(0, 200))
    }
    if (!res.ok) {
      console.error(`[API] ${url} — ${res.status}:`, json.error || res.statusText)
      throw new Error(json.error || res.statusText)
    }
    console.log(`[API] ${url} — OK`, json.success !== undefined ? `success=${json.success}` : '')
    return json
  } catch (err) {
    console.error(`[API] ${url} — FAILED:`, err.message)
    throw err
  }
}

export const api = {
  merchants: () => request('/merchants'),
  merchant: (id) => request(`/merchants/${id}`),
  createMerchant: (body) => request('/merchants', { method: 'POST', body: JSON.stringify(body) }),
  updateMerchant: (id, body) => request(`/merchants/${id}`, { method: 'PUT', body: JSON.stringify(body) }),
  transactions: (params) => request('/transactions?' + new URLSearchParams(params || {})),
  performance: (params) => request('/performance?' + new URLSearchParams(params || {})),
  dashboard: (params) => {
    const qs = params && Object.keys(params).length ? new URLSearchParams(params).toString() : ''
    return request('/dashboard' + (qs ? '?' + qs : ''))
  },
  performancePublishers: (params) => request('/performance-publishers?' + new URLSearchParams(params || {})),
  performancePublishersDaily: (params) => request('/performance-publishers-daily?' + new URLSearchParams(params || {})),
  sync: (body) => request('/sync', { method: 'POST', body: JSON.stringify(body || {}) }),
  validation: (body) => request('/validation', { method: 'POST', body: JSON.stringify(body) }),
  health: () => request('/health'),
  settings: () => request('/settings'),
  updateSettings: (body) => request('/settings', { method: 'PUT', body: JSON.stringify(body) }),
  merchantPublishers: (id) => request(`/merchants/${id}/publishers`),
  fetchMerchantPublishers: (id) => request(`/merchants/${id}/fetch-publishers`, { method: 'POST' }),
  fetchMerchantPerformanceDaily: (id) => request(`/merchants/${id}/fetch-performance-daily`, { method: 'POST' }),
  /** Ίδιο endpoint — όνομα για UI «Scrape performance» */
  scrapeMerchantPerformance: (id) => request(`/merchants/${id}/fetch-performance-daily`, { method: 'POST' }),
  performanceDaily: (params) => request('/performance-daily?' + new URLSearchParams(params || {})),
  /** @param {number|string} merchantId @param {{start_date:string,end_date:string}} params */
  webgainsKpis: (merchantId, params) =>
    request(`/merchants/${merchantId}/webgains-kpis?` + new URLSearchParams(params || {})),
}
