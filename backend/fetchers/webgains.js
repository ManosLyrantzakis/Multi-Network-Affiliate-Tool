import config from '../config.js';
import { decrypt } from '../utils/crypto.js';

const BASE = config.WEBGAINS_API_BASE || 'https://platform-api.webgains.com';
const MAX_RETRIES = 3;
const RETRY_DELAY_SECONDS = 2;
const TOKEN_REFRESH_SKEW_MS = 60 * 1000;

export class AuthError extends Error {
  constructor(message) {
    super(message);
    this.name = 'AuthError';
  }
}

/**
 * @typedef {Object} WebgainsToken
 * @property {string} access_token
 * @property {number} expires_in
 * @property {string} [refresh_token]
 * @property {number} expires_at
 * @property {string} token_type
 */

/**
 * @typedef {Object} WebgainsTransactionItem
 * @property {string} [id]
 * @property {string} [name]
 * @property {number} [quantity]
 * @property {number} [price]
 * @property {string} [currency]
 */

/**
 * @typedef {Object} WebgainsTransaction
 * @property {string|number} id
 * @property {string} [date]
 * @property {{amount:number,currency_code:string}} [value]
 *   `amount` is in minor currency units (cents/øre/pence) per Platform API; normalized to major units in normalize.js.
 * @property {{amount:number,currency_code:string}} [commission]
 * @property {string} [payment_status]
 * @property {string} [order_reference]
 * @property {Object} [campaign]
 * @property {Object} [program]
 * @property {WebgainsTransactionItem[]} [items]
 */

/**
 * @typedef {Object} WebgainsPerformanceResult
 * @property {string|number} [program_id]
 * @property {number} clicks
 * @property {number} impressions
 * @property {number} transactions
 * @property {number} commission
 * @property {number} revenue
 * @property {string} currency
 */

/**
 * @typedef {Object} WebgainsKPIs
 * @property {'webgains'} network
 * @property {{start:string,end:string}} period
 * @property {number} clicks
 * @property {number} impressions
 * @property {number} transactions
 * @property {number} commission
 * @property {number} revenue
 * @property {number} avg_commission
 * @property {number} avg_transaction_value
 * @property {string} currency
 * @property {Array<Object>} programs
 */

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function toNumber(v) {
  if (v == null || v === '') return 0;
  const n = Number(String(v).replace(/,/g, ''));
  return Number.isFinite(n) ? n : 0;
}

function toUnixSeconds(dateYmd, endOfDay = false) {
  const suffix = endOfDay ? 'T23:59:59Z' : 'T00:00:00Z';
  const d = new Date(`${String(dateYmd).slice(0, 10)}${suffix}`);
  return Math.floor(d.getTime() / 1000);
}

/** Query `start_date` / `end_date` for report endpoints expect YYYY-MM-DD. */
function toYmdParam(d) {
  if (d == null || d === '') return '';
  if (typeof d === 'number') return new Date(d * 1000).toISOString().slice(0, 10);
  const s = String(d);
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10);
  if (/^\d{10,13}$/.test(s)) {
    const n = Number(s);
    return new Date(n < 1e12 ? n * 1000 : n).toISOString().slice(0, 10);
  }
  return s.slice(0, 10);
}

function appendArrayParam(params, key, values) {
  if (!Array.isArray(values)) return;
  for (const value of values) {
    if (value != null && value !== '') params.append(key, String(value));
  }
}

/** Webgains list GET uses `filters[payment_statuses][]` with integer codes (see platform API docs). */
function mapPaymentStatusesToFilterInts(statuses) {
  const list = Array.isArray(statuses) ? statuses : [statuses];
  const labelToCode = {
    confirmed: 10,
    cancelled: 20,
    canceled: 20,
    delayed: 25,
    pending: 30,
  };
  const out = [];
  for (const x of list) {
    if (x == null || x === '') continue;
    if (typeof x === 'number' && Number.isFinite(x)) {
      out.push(x);
      continue;
    }
    const s = String(x).trim().toLowerCase();
    if (/^\d+$/.test(s)) {
      out.push(Number(s));
      continue;
    }
    const code = labelToCode[s];
    if (code != null) out.push(code);
  }
  return out.length ? out : [10];
}

function appendFiltersArrayParam(params, filterKey, values) {
  if (!Array.isArray(values)) return;
  const key = `filters[${filterKey}][]`;
  for (const value of values) {
    if (value != null && value !== '') params.append(key, String(value));
  }
}

/** Undocumented / older flat query (still works for some accounts when filters[...] returns 0 rows). */
function buildMerchantsTxQueryLegacyFlat({
  startUnix,
  endUnix,
  programs,
  payment_statuses,
  campaign_ids,
  currentPage,
  maxSize,
  sort,
  sort_order,
}) {
  const query = new URLSearchParams();
  query.append('start_date', String(startUnix));
  query.append('end_date', String(endUnix));
  query.append('page', String(currentPage));
  query.append('size', String(maxSize));
  query.append('sort', String(sort || 'date'));
  query.append('sort_order', String(sort_order || 'DESC'));
  if (programs.length) {
    appendArrayParam(query, 'program_ids[]', programs);
  }
  appendArrayParam(query, 'payment_statuses[]', payment_statuses);
  appendArrayParam(query, 'campaign_ids[]', campaign_ids);
  return query;
}

function buildMerchantsTxQueryFilters({
  startUnix,
  endUnix,
  programs,
  paymentInts,
  campaignInts,
  currentPage,
  maxSize,
  sort,
  sort_order,
}) {
  const query = new URLSearchParams({
    'filters[start_date]': String(startUnix),
    'filters[end_date]': String(endUnix),
    page: String(currentPage),
    size: String(maxSize),
    sort: String(sort || 'date'),
    sort_order: String(sort_order || 'DESC'),
  });
  if (programs.length) {
    appendFiltersArrayParam(
      query,
      'program_ids',
      programs.map((p) => {
        const n = Number(p);
        return Number.isFinite(n) ? n : p;
      })
    );
  }
  appendFiltersArrayParam(
    query,
    'payment_statuses',
    paymentInts.map((n) => Number(n)).filter((n) => Number.isFinite(n))
  );
  if (campaignInts.length) {
    appendFiltersArrayParam(query, 'campaign_ids', campaignInts);
  }
  return query;
}

/** Some Webgains accounts show one id for brand + program; the API may still expect that id in `program_ids`. */
function warnIfProgramIdsMatchMerchant(programList, merchantId) {
  const mid = String(merchantId || '').trim();
  if (!mid) return;
  const raw = (Array.isArray(programList) ? programList : [programList])
    .map((s) => String(s || '').trim())
    .filter(Boolean);
  for (const p of raw) {
    if (p === mid) {
      console.warn(
        `[WEBGAINS] Program ID "${p}" equals merchant id — treating as configured program id (some accounts use one id for both).`
      );
    }
  }
}

function pickFirst(obj, keys) {
  for (const key of keys) {
    if (obj && Object.prototype.hasOwnProperty.call(obj, key) && obj[key] != null && obj[key] !== '') {
      return obj[key];
    }
  }
  return null;
}

function normalizePerformanceRow(row, fallbackProgramId = null, fallbackCurrency = 'DKK') {
  const program_id =
    pickFirst(row, ['program_id', 'programId', 'program', 'programID', 'id']) ?? fallbackProgramId ?? null;
  return {
    program_id,
    clicks: toNumber(pickFirst(row, ['clicks', 'click_count', 'number_of_clicks'])),
    impressions: toNumber(pickFirst(row, ['impressions', 'impression_count', 'number_of_impressions'])),
    transactions: toNumber(pickFirst(row, ['transactions', 'sales', 'number_of_sales', 'sale_count'])),
    commission: toNumber(pickFirst(row, ['commission', 'commissions', 'total_commission', 'affiliate_commission'])),
    revenue: toNumber(pickFirst(row, ['revenue', 'value', 'sales_value', 'turnover', 'sale_value'])),
    currency: String(pickFirst(row, ['currency', 'currency_code']) || fallbackCurrency),
  };
}

function parseListPayload(payload) {
  if (Array.isArray(payload)) return payload;
  if (!payload || typeof payload !== 'object') return [];
  if (Array.isArray(payload.data)) return payload.data;
  if (Array.isArray(payload.items)) return payload.items;
  if (Array.isArray(payload.results)) return payload.results;
  if (Array.isArray(payload.transactions)) return payload.transactions;
  return [];
}

export class WebgainsAuthService {
  /**
   * @param {{baseUrl:string,clientId:string,clientSecret:string,username:string,password:string}} opts
   */
  constructor(opts) {
    this.baseUrl = opts.baseUrl;
    this.clientId = opts.clientId;
    this.clientSecret = opts.clientSecret;
    this.username = opts.username;
    this.password = opts.password;
    /** @type {WebgainsToken|null} */
    this.token = null;
  }

  async authenticate() {
    const payload = new URLSearchParams({
      grant_type: 'password',
      client_id: this.clientId,
      client_secret: this.clientSecret,
      scope: '*',
      username: this.username,
      password: this.password,
    });
    const token = await this._requestToken(payload);
    this.token = token;
    return token;
  }

  async refreshAccessToken() {
    if (!this.token?.refresh_token) {
      return this.authenticate();
    }
    const payload = new URLSearchParams({
      grant_type: 'refresh_token',
      client_id: this.clientId,
      client_secret: this.clientSecret,
      refresh_token: this.token.refresh_token,
      scope: '*',
    });
    try {
      const token = await this._requestToken(payload);
      this.token = token;
      return token;
    } catch (e) {
      return this.authenticate();
    }
  }

  async getValidAccessToken() {
    const now = Date.now();
    if (!this.token) {
      await this.authenticate();
    } else if ((this.token.expires_at - now) <= TOKEN_REFRESH_SKEW_MS) {
      await this.refreshAccessToken();
    }
    return this.token.access_token;
  }

  async _requestToken(bodyParams) {
    const res = await fetch(`${this.baseUrl}/oauth/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: bodyParams,
      signal: AbortSignal.timeout(60000),
    });
    const text = await res.text();
    let data = {};
    try {
      data = text ? JSON.parse(text) : {};
    } catch (_) {
      data = {};
    }
    if (!res.ok) {
      throw new AuthError(`Webgains auth failed (${res.status}): ${text.slice(0, 400)}`);
    }
    const expiresIn = Number(data.expires_in || 0);
    return {
      access_token: String(data.access_token || ''),
      refresh_token: data.refresh_token ? String(data.refresh_token) : '',
      expires_in: expiresIn,
      expires_at: Date.now() + Math.max(1, expiresIn) * 1000,
      token_type: String(data.token_type || 'Bearer'),
    };
  }
}

export class WebgainsService {
  /**
   * @param {{baseUrl:string,merchantId:string,programIds:string[],defaultCurrency:string,authService:WebgainsAuthService}} opts
   */
  constructor(opts) {
    this.baseUrl = opts.baseUrl;
    this.merchantId = String(opts.merchantId || '');
    this.programIds = Array.isArray(opts.programIds) ? opts.programIds.map(String) : [];
    this.defaultCurrency = opts.defaultCurrency || 'DKK';
    this.authService = opts.authService;
  }

  async getPerformanceReport(params = {}) {
    const {
      program = this.programIds,
      start_date,
      end_date,
      detail_level = 'summary',
      type = 'affiliate',
      locale = 'en_GB',
      limit = 1000,
      currency = this.defaultCurrency,
      event_type = ['confirmed'],
      timezone = 'UTC',
    } = params;
    const programs = (Array.isArray(program) ? program : [program]).map(String).filter(Boolean);
    const out = [];
    for (const programId of programs) {
      const query = new URLSearchParams({
        start_date: String(start_date),
        end_date: String(end_date),
        detail_level: String(detail_level),
        type: String(type),
        locale: String(locale),
        limit: String(limit),
        currency: String(currency),
        timezone: String(timezone || 'UTC'),
      });
      query.append('program[]', String(programId));
      appendArrayParam(query, 'event_type[]', event_type);
      const payload = await this._request(
        `/auth/merchant/reports/performance?${query.toString()}`,
        { method: 'GET' }
      );
      const rows = parseListPayload(payload);
      if (!rows.length && payload && typeof payload === 'object') {
        rows.push(payload);
      }
      for (const row of rows) {
        out.push(normalizePerformanceRow(row, programId, currency));
      }
    }
    return out;
  }

  async getTransactions(params = {}) {
    const merged = { ...params, program_ids: params.program_ids ?? this.programIds };
    const programs = (Array.isArray(merged.program_ids) ? merged.program_ids : [merged.program_ids])
      .map((s) => String(s).trim())
      .filter(Boolean);
    warnIfProgramIdsMatchMerchant(programs, this.merchantId);
    const eff = { ...merged, program_ids: programs };

    if (!programs.length) {
      console.warn(
        '[WEBGAINS] No Program ID(s) configured; trying GET /merchants/{id}/transactions without program_ids[] (if the API allows).'
      );
      return await this.getTransactionsLegacyMerchantGet({ ...eff, program_ids: [] });
    }

    try {
      return await this.getTransactionsPostReport(eff);
    } catch (e) {
      if (e instanceof AuthError && /forbidden/i.test(String(e.message || ''))) {
        console.warn(
          '[WEBGAINS] POST /auth/merchant/reports/transactions forbidden; falling back to GET /merchants/{id}/transactions'
        );
        return await this.getTransactionsLegacyMerchantGet(eff);
      }
      throw e;
    }
  }

  /**
   * Transaction report (POST). Some accounts return 403 here even with a valid token.
   */
  async getTransactionsPostReport(params = {}) {
    const {
      start_date,
      end_date,
      program_ids = this.programIds,
      payment_statuses = ['confirmed'],
      campaign_ids = [],
      page = 1,
      size = 1000,
      sort = 'date',
      sort_order = 'DESC',
    } = params;
    const startStr = toYmdParam(start_date);
    const endStr = toYmdParam(end_date);
    let programs = (Array.isArray(program_ids) ? program_ids : [program_ids])
      .map((s) => String(s).trim())
      .filter(Boolean);

    const maxSize = Math.min(1000, Math.max(1, Number(size || 1000)));
    const all = [];

    for (const programId of programs) {
      let currentPage = Number(page || 1);
      while (true) {
        const body = {
          start_date: startStr,
          end_date: endStr,
          detail_level: 'detail',
          locale: 'en_GB',
          limit: maxSize,
          currency: String(this.defaultCurrency || 'DKK'),
          timezone: 'UTC',
          page: currentPage,
          sort: String(sort || 'date'),
          sort_order: String(sort_order || 'DESC'),
          program_ids: [programId],
          payment_statuses,
          campaign_ids: (campaign_ids || []).map(String).filter(Boolean),
        };
        const payload = await this._request('/auth/merchant/reports/transactions', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        });
        const rows = parseListPayload(payload);
        if (!rows.length) break;
        all.push(...rows);
        if (rows.length < maxSize) break;
        currentPage += 1;
      }
    }
    return all;
  }

  /**
   * GET /merchants/{merchant}/transactions — try OpenAPI `filters[...]` shape first; if page 1 returns
   * no rows, fall back to legacy flat params (start_date, program_ids[], payment_statuses[]) which
   * some deployments still require.
   */
  async getTransactionsLegacyMerchantGet(params = {}) {
    const {
      start_date,
      end_date,
      program_ids = this.programIds,
      payment_statuses = ['confirmed'],
      campaign_ids = [],
      page = 1,
      size = 1000,
      sort = 'date',
      sort_order = 'DESC',
    } = params;
    const programs = (Array.isArray(program_ids) ? program_ids : [program_ids])
      .map((s) => String(s).trim())
      .filter(Boolean);
    const startUnix =
      typeof start_date === 'number' ? start_date : toUnixSeconds(start_date, false);
    const endUnix = typeof end_date === 'number' ? end_date : toUnixSeconds(end_date, true);
    const paymentInts = mapPaymentStatusesToFilterInts(payment_statuses);
    const campaignInts = (Array.isArray(campaign_ids) ? campaign_ids : [campaign_ids])
      .map((x) => Number(String(x).trim()))
      .filter((n) => Number.isFinite(n));
    const maxSize = Math.min(1000, Math.max(1, Number(size || 1000)));
    const all = [];
    let currentPage = Number(page || 1);
    let useLegacyFlat = false;

    while (true) {
      const query = useLegacyFlat
        ? buildMerchantsTxQueryLegacyFlat({
            startUnix,
            endUnix,
            programs,
            payment_statuses,
            campaign_ids,
            currentPage,
            maxSize,
            sort,
            sort_order,
          })
        : buildMerchantsTxQueryFilters({
            startUnix,
            endUnix,
            programs,
            paymentInts,
            campaignInts,
            currentPage,
            maxSize,
            sort,
            sort_order,
          });
      const url = `/merchants/${encodeURIComponent(this.merchantId)}/transactions?${query.toString()}`;
      console.log(
        '[WEBGAINS DEBUG] merchantId:',
        this.merchantId,
        '| programs:',
        programs,
        '| query:',
        useLegacyFlat ? 'legacy-flat' : 'filters',
        '| URL:',
        url
      );
      let payload = await this._request(url, { method: 'GET' });
      let rows = parseListPayload(payload);

      if (currentPage === 1 && !useLegacyFlat && !rows.length) {
        console.warn(
          '[WEBGAINS] filters[...] query returned 0 rows; retrying legacy flat query (start_date, program_ids[], payment_statuses[]).'
        );
        useLegacyFlat = true;
        const q2 = buildMerchantsTxQueryLegacyFlat({
          startUnix,
          endUnix,
          programs,
          payment_statuses,
          campaign_ids,
          currentPage,
          maxSize,
          sort,
          sort_order,
        });
        const url2 = `/merchants/${encodeURIComponent(this.merchantId)}/transactions?${q2.toString()}`;
        console.log('[WEBGAINS DEBUG] merchantId:', this.merchantId, '| programs:', programs, '| query: legacy-flat | URL:', url2);
        payload = await this._request(url2, { method: 'GET' });
        rows = parseListPayload(payload);
      }

      if (!rows.length) break;
      all.push(...rows);
      const pag = payload && typeof payload === 'object' ? payload.pagination : null;
      if (pag && typeof pag.last_page === 'number' && typeof pag.current_page === 'number') {
        if (currentPage >= pag.last_page) break;
      } else if (rows.length < maxSize) {
        break;
      }
      currentPage += 1;
    }
    return all;
  }

  async getTransactionDetails(transactionId, programId) {
    const query = new URLSearchParams();
    query.append('program[]', String(programId));
    return this._request(
      `/auth/merchant/reports/transaction/${encodeURIComponent(transactionId)}/info?${query.toString()}`,
      { method: 'GET' }
    );
  }

  async getWebgainsKPIs(startDate, endDate, programIds = this.programIds, options = {}) {
    const currency = options.currency || this.defaultCurrency || 'DKK';
    const status = options.status || ['confirmed'];
    const timezone = options.timezone || 'UTC';
    const trafficRows = await this.getPerformanceReport({
      program: programIds,
      start_date: startDate,
      end_date: endDate,
      detail_level: 'summary',
      type: 'click-active-affiliate',
      currency,
      event_type: status,
      timezone,
    });
    const affiliateRows = await this.getPerformanceReport({
      program: programIds,
      start_date: startDate,
      end_date: endDate,
      detail_level: 'summary',
      type: 'affiliate',
      currency,
      event_type: status,
      timezone,
    });

    const byProgram = new Map();
    const ensureProgram = (programId) => {
      const key = String(programId || 'unknown');
      if (!byProgram.has(key)) {
        byProgram.set(key, {
          program_id: key,
          clicks: 0,
          impressions: 0,
          transactions: 0,
          commission: 0,
          revenue: 0,
          avg_commission: 0,
          avg_transaction_value: 0,
          currency,
        });
      }
      return byProgram.get(key);
    };

    for (const row of trafficRows) {
      const p = ensureProgram(row.program_id);
      p.clicks += toNumber(row.clicks);
      p.impressions += toNumber(row.impressions);
    }
    for (const row of affiliateRows) {
      const p = ensureProgram(row.program_id);
      p.transactions += toNumber(row.transactions);
      p.commission += toNumber(row.commission);
      p.revenue += toNumber(row.revenue);
    }

    const programs = Array.from(byProgram.values()).map((p) => {
      const tx = toNumber(p.transactions);
      return {
        ...p,
        avg_commission: tx > 0 ? p.commission / tx : 0,
        avg_transaction_value: tx > 0 ? p.revenue / tx : 0,
      };
    });

    const total = programs.reduce(
      (acc, row) => ({
        clicks: acc.clicks + row.clicks,
        impressions: acc.impressions + row.impressions,
        transactions: acc.transactions + row.transactions,
        commission: acc.commission + row.commission,
        revenue: acc.revenue + row.revenue,
      }),
      { clicks: 0, impressions: 0, transactions: 0, commission: 0, revenue: 0 }
    );

    const tx = toNumber(total.transactions);
    return {
      network: 'webgains',
      period: { start: String(startDate).slice(0, 10), end: String(endDate).slice(0, 10) },
      clicks: total.clicks,
      impressions: total.impressions,
      transactions: total.transactions,
      commission: total.commission,
      revenue: total.revenue,
      avg_commission: tx > 0 ? total.commission / tx : 0,
      avg_transaction_value: tx > 0 ? total.revenue / tx : 0,
      currency,
      programs,
    };
  }

  async _request(pathWithQuery, init = {}, attempt = 0, hasRefreshed = false) {
    const token = await this.authService.getValidAccessToken();
    const res = await fetch(`${this.baseUrl}${pathWithQuery}`, {
      ...init,
      headers: {
        ...(init.headers || {}),
        Authorization: `Bearer ${token}`,
      },
      signal: AbortSignal.timeout(60000),
    });

    if (res.status === 429 && attempt < MAX_RETRIES) {
      const delayMs = RETRY_DELAY_SECONDS ** (attempt + 1) * 1000;
      await sleep(delayMs);
      return this._request(pathWithQuery, init, attempt + 1, hasRefreshed);
    }

    if (res.status === 403) {
      if (hasRefreshed) throw new AuthError('Webgains request forbidden after token refresh');
      await this.authService.refreshAccessToken();
      return this._request(pathWithQuery, init, attempt, true);
    }

    const text = await res.text();
    let payload = {};
    try {
      payload = text ? JSON.parse(text) : {};
    } catch (_) {
      payload = text;
    }

    if (res.status === 422) {
      console.error('[WEBGAINS] Validation error (422)', { pathWithQuery, params: pathWithQuery, response: payload });
      return payload;
    }
    if (res.status >= 500) {
      console.error('[WEBGAINS] Server error', { status: res.status, pathWithQuery, response: payload });
      throw new Error(`Webgains server error ${res.status}`);
    }
    if (!res.ok) {
      throw new Error(`Webgains request failed (${res.status}): ${typeof payload === 'string' ? payload.slice(0, 400) : JSON.stringify(payload).slice(0, 400)}`);
    }
    return payload;
  }
}

function resolveProgramIds(merchant) {
  const fromMerchant = String(merchant?.publisher_id || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  if (fromMerchant.length) return fromMerchant;
  return config.WEBGAINS_PROGRAM_IDS || [];
}

function buildDefaultService(merchant) {
  const merchantClientId = decrypt(merchant?.api_key_encrypted || '') || merchant?.api_key_encrypted || '';
  const merchantClientSecret = decrypt(merchant?.api_token_encrypted || '') || merchant?.api_token_encrypted || '';
  const clientId = config.WEBGAINS_CLIENT_ID || merchantClientId || '';
  const clientSecret = config.WEBGAINS_CLIENT_SECRET || merchantClientSecret || '';
  const username = config.WEBGAINS_USERNAME || '';
  const password = config.WEBGAINS_PASSWORD || '';
  const envMerchantId = String(config.WEBGAINS_MERCHANT_ID || '').trim();
  const advMerchantId = String(merchant?.advertiser_id || '').trim();
  /** Per-merchant Merchant ID (UI) wins so edits apply; env is fallback when the field is empty. */
  const merchantId = advMerchantId || envMerchantId;
  if (envMerchantId && advMerchantId && envMerchantId !== advMerchantId) {
    console.warn(
      `[WEBGAINS] Using merchant Merchant ID / advertiser_id (${advMerchantId}) for /merchants/{id} paths; WEBGAINS_MERCHANT_ID in env (${envMerchantId}) is ignored. Clear WEBGAINS_MERCHANT_ID in .env if you want env-only, or align both values.`
    );
  }
  if (!clientId || !clientSecret || !username || !password) {
    throw new AuthError('Webgains OAuth credentials are not configured');
  }
  if (!merchantId) {
    throw new Error(
      'Webgains merchant id is not configured: set WEBGAINS_MERCHANT_ID in backend .env or Merchant ID (Advertiser ID) on the merchant'
    );
  }
  const authService = new WebgainsAuthService({
    baseUrl: BASE,
    clientId,
    clientSecret,
    username,
    password,
  });
  return new WebgainsService({
    baseUrl: BASE,
    merchantId: String(merchantId),
    programIds: resolveProgramIds(merchant),
    defaultCurrency: 'DKK',
    authService,
  });
}

export async function fetchTransactions(merchant, start_date, end_date) {
  const service = buildDefaultService(merchant);
  return service.getTransactions({
    start_date,
    end_date,
    program_ids: resolveProgramIds(merchant),
    payment_statuses: ['confirmed'],
    page: 1,
    size: 1000,
    sort: 'date',
    sort_order: 'DESC',
  });
}

export async function getWebgainsKPIs(startDate, endDate, programIds = null, merchant = null) {
  const service = buildDefaultService(merchant);
  return service.getWebgainsKPIs(startDate, endDate, programIds || resolveProgramIds(merchant), {
    status: ['confirmed'],
    currency: 'DKK',
    timezone: 'UTC',
  });
}
