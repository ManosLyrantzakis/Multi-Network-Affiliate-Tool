const STATUS_MAP = {
  impact: { approved: 'approved', pending: 'pending', declined: 'declined', locked: 'approved', rejected: 'declined', default: 'pending', reversed: 'declined' },
  awin: { pending: 'pending', approved: 'approved', declined: 'declined', deleted: 'declined', deferred: 'pending' },
  cj: { new: 'pending', extended: 'pending', locked: 'approved', closed: 'approved', rejected: 'declined' },
  webgains: {
    confirmed: 'approved',
    cancelled: 'declined',
    canceled: 'declined',
    delayed: 'pending',
    pending: 'pending',
    /** List GET returns numeric payment_status (e.g. 10 = confirmed per API docs). */
    '10': 'approved',
    '20': 'declined',
    '25': 'pending',
    '30': 'pending',
    '40': 'pending',
    '50': 'pending',
    '60': 'pending',
    '70': 'pending',
  },
};

function toUtcIso(dt) {
  if (dt == null) return null;
  if (typeof dt === 'string') {
    try {
      const d = new Date(dt.replace('Z', '+00:00'));
      return isNaN(d.getTime()) ? dt : d.toISOString().replace('.000Z', 'Z');
    } catch { return dt; }
  }
  if (dt instanceof Date) return dt.toISOString().replace('.000Z', 'Z');
  return String(dt);
}

function toDecimal(val) {
  if (val == null) return 0;
  if (typeof val === 'number') return val;
  const n = parseFloat(String(val));
  return isNaN(n) ? 0 : n;
}

function normalizeStatus(network, rawStatus) {
  let v = rawStatus;
  if (v != null && typeof v === 'object') {
    v = v.code ?? v.status ?? v.label ?? v.name ?? v.value ?? v.slug;
  }
  const s = String(v ?? '').trim().toLowerCase();
  const mapped = STATUS_MAP[network]?.[s];
  if (mapped) return mapped;
  if (['approved', 'declined', 'pending'].includes(s)) return s;
  return 'pending';
}

function mapImpact(raw, merchant_id, _opts) {
  return {
    network: 'impact', merchant_id,
    external_id: String(raw.Id || raw.ActionId || raw.id || raw.transactionId || ''),
    amount: toDecimal(raw.Amount || raw.saleAmount || raw.amount),
    currency: raw.Currency || raw.currency || 'EUR',
    commission: toDecimal(raw.Payout || raw.DeltaPayout || raw.commissionAmount || raw.commission),
    status: normalizeStatus('impact', raw.State || raw.status),
    transaction_datetime_utc: toUtcIso(raw.EventDate || raw.ActionDate || raw.CreationDate || raw.eventDate || raw.saleDate),
    click_datetime_utc: toUtcIso(raw.ReferringDate || raw.clickDate),
    publisher_id: String(raw.MediaPartnerId || raw.publisherId || ''),
    offer_title: raw.CampaignName || raw.CampaignId || raw.offerTitle || raw.offerId || '',
  };
}

function extractAmount(obj) {
  if (obj == null) return 0;
  if (typeof obj === 'number') return obj;
  if (typeof obj === 'object' && 'amount' in obj) return toDecimal(obj.amount);
  return toDecimal(obj);
}

function mapAwin(raw, merchant_id, _opts) {
  return {
    network: 'awin', merchant_id,
    external_id: String(raw.id || raw.transactionId || ''),
    amount: extractAmount(raw.saleAmount || raw.amount),
    currency: (raw.saleAmount?.currency || raw.commissionAmount?.currency || raw.currency || 'EUR'),
    commission: extractAmount(raw.commissionAmount || raw.commission),
    status: normalizeStatus('awin', raw.commissionStatus || raw.status),
    transaction_datetime_utc: toUtcIso(raw.transactionDate || raw.eventDate),
    click_datetime_utc: toUtcIso(raw.clickDate),
    publisher_id: String(raw.publisherId || ''),
    offer_title: raw.campaign || raw.offerName || raw.offerId || raw.orderRef || '',
  };
}

function mapCj(raw, merchant_id, _opts) {
  return {
    network: 'cj', merchant_id,
    external_id: String(raw.id || raw.transactionId || ''),
    amount: toDecimal(raw.saleAmount || raw.sale_amount || raw.amount),
    currency: raw.currency || 'EUR',
    commission: toDecimal(raw.commissionAmount || raw.commission_amount || raw.commission),
    status: normalizeStatus('cj', raw.status),
    transaction_datetime_utc: toUtcIso(raw.eventDate || raw.event_date),
    click_datetime_utc: toUtcIso(raw.clickDate),
    publisher_id: String(raw.publisherId || raw.publisher_id || ''),
    offer_title: raw.offerName || raw.offerId,
  };
}

/** Webgains GET /merchants/.../transactions uses UNIX seconds for `date`. */
function webgainsListDateToUtcIso(d) {
  if (d == null || d === '') return null;
  if (typeof d === 'number' && Number.isFinite(d)) {
    const ms = d < 1e12 ? d * 1000 : d;
    const t = new Date(ms).getTime();
    return Number.isNaN(t) ? null : new Date(ms).toISOString().replace('.000Z', 'Z');
  }
  return toUtcIso(d);
}

/** Currencies where API amounts are already in whole units (no ÷100). */
const WEBGAINS_ZERO_DECIMAL = new Set(['JPY', 'KRW', 'VND', 'CLP', 'UGX', 'ISK', 'XOF', 'XAF']);

/**
 * Webgains Platform `FinancialAmount.amount` is in minor units (øre/cent/pence) for typical 2-decimal currencies.
 * Example from docs: {"amount":10050,"currency_code":"GBP"} → 100.50 GBP.
 * Float amounts are treated as already major units.
 */
function webgainsMinorToMajor(amount, currencyCode) {
  if (amount == null || amount === '') return 0;
  const cur = String(currencyCode || '').toUpperCase();
  const n = typeof amount === 'number' ? amount : parseFloat(String(amount).replace(/,/g, ''));
  if (!Number.isFinite(n)) return 0;
  if (WEBGAINS_ZERO_DECIMAL.has(cur)) return n;
  if (Number.isInteger(n)) return n / 100;
  return n;
}

function pickWebgainsAmountCurrency(raw, value, commission) {
  const v = value && typeof value === 'object' ? value : {};
  const c = commission && typeof commission === 'object' ? commission : {};
  const code =
    v.currency_code ||
    v.currency ||
    raw.program?.currency_code ||
    raw.program?.currency ||
    raw.campaign?.currency_code ||
    raw.campaign?.currency ||
    raw.currency ||
    raw.currency_code ||
    c.currency_code ||
    c.currency ||
    '';
  const u = String(code || '').trim().toUpperCase();
  return /^[A-Z]{3}$/.test(u) ? u : 'DKK';
}

function pickWebgainsCommissionCurrency(raw, value, commission) {
  const v = value && typeof value === 'object' ? value : {};
  const c = commission && typeof commission === 'object' ? commission : {};
  const fromComm = c.currency_code || c.currency;
  if (fromComm) {
    const u = String(fromComm).trim().toUpperCase();
    if (/^[A-Z]{3}$/.test(u)) return u;
  }
  return pickWebgainsAmountCurrency(raw, value, commission);
}

function mapWebgains(raw, merchant_id, options = {}) {
  const value = raw.value || raw.sale_amount || raw.saleAmount || {};
  const commission = raw.commission || raw.commission_amount || {};
  const amountCur = pickWebgainsAmountCurrency(raw, value, commission);
  const commCur = pickWebgainsCommissionCurrency(raw, value, commission);
  const rawAmount = value.amount ?? raw.value_amount ?? raw.amount ?? raw.sale_amount ?? raw.saleAmount;
  const rawCommission = commission.amount ?? raw.commission_amount ?? raw.commission;
  let currency = amountCur;
  const force = options.forceRowCurrency && String(options.forceRowCurrency).trim().toUpperCase();
  if (force && /^[A-Z]{3}$/.test(force)) currency = force;
  return {
    network: 'webgains', merchant_id,
    external_id: String(
      raw.id || raw.transactionId || raw.transaction_id || raw.order_reference || raw.order_id || raw.orderId || ''
    ),
    amount: toDecimal(webgainsMinorToMajor(rawAmount, amountCur)),
    currency,
    commission: toDecimal(webgainsMinorToMajor(rawCommission, commCur)),
    status: normalizeStatus('webgains', raw.payment_status || raw.status),
    transaction_datetime_utc: webgainsListDateToUtcIso(
      raw.date || raw.transaction_date || raw.eventDate || raw.DATE
    ),
    click_datetime_utc: webgainsListDateToUtcIso(raw.click_date || raw.clickDate || raw.click?.date),
    publisher_id: String(
      (raw.affiliate_id ||
        raw.publisher_id ||
        raw.publisherId ||
        raw.affiliateId ||
        raw.campaign?.publisher?.id) ??
        ''
    ),
    offer_title: raw.program?.name || raw.campaign?.name || raw.order_reference || '',
  };
}

export function normalizeTransactions(network, rawList, merchant_id, options = {}) {
  const mapper = { impact: mapImpact, awin: mapAwin, cj: mapCj, webgains: mapWebgains };
  const fn = mapper[network];
  if (!fn) return [];
  const opts = network === 'webgains' ? options : {};
  return rawList.filter(r => r && typeof r === 'object').map(r => fn(r, merchant_id, opts));
}
