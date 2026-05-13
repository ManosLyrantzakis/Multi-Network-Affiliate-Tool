/**
 * Default display currency when aggregates (performance tables) don't carry ISO code per row.
 * Webgains programs for this stack are typically DKK.
 */
export function defaultCurrencyForNetwork(network) {
  const n = String(network || '').toLowerCase()
  if (n === 'webgains') return 'DKK'
  return 'USD'
}

/**
 * Per-transaction fallback when `currency` is missing on the row.
 * Historic list UI used EUR; Webgains rows should read as DKK.
 */
export function transactionDisplayCurrency(currencyCode, network) {
  const explicit = currencyCode && String(currencyCode).trim().toUpperCase()
  if (explicit && /^[A-Z]{3}$/.test(explicit)) return explicit
  return String(network || '').toLowerCase() === 'webgains' ? 'DKK' : 'EUR'
}

/**
 * @param {number|string} amount
 * @param {string} [currencyCode='USD'] ISO 4217
 * @param {string} [locale='da-DK'] — da-DK formats DKK like the Danish locale / Webgains UI
 */
export function formatMoneyAmount(amount, currencyCode = 'USD', locale = 'da-DK') {
  const raw = String(currencyCode || 'USD').trim().toUpperCase()
  const c = /^[A-Z]{3}$/.test(raw) ? raw : 'USD'
  try {
    return new Intl.NumberFormat(locale, {
      style: 'currency',
      currency: c,
      maximumFractionDigits: 2,
    }).format(Number(amount) || 0)
  } catch {
    return `${Number(amount) || 0} ${c}`
  }
}
