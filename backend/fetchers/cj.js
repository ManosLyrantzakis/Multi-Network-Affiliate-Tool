import { decrypt } from '../utils/crypto.js';
import config from '../config.js';
import { XMLParser } from 'fast-xml-parser';
import * as db from '../db/index.js';

const BASE = config.CJ_REST_BASE || 'https://commissions.rakutenadvertising.com';
const PUBLISHER_LOOKUP_BASE = 'https://publisher-lookup.api.cj.com/v2';
const DEFAULT_COMMISSIONS_GQL = 'https://commissions.api.cj.com/query';
const MAX_RETRIES = 3;
const RETRY_DELAY = 2;

const xmlParser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '',
  parseTagValue: true,
  trimValues: true,
});

function _getCommissionsGraphqlEndpoint() {
  let u = String(config.CJ_COMMISSIONS_GQL_ENDPOINT || DEFAULT_COMMISSIONS_GQL).trim();
  if (!u) u = DEFAULT_COMMISSIONS_GQL;
  // Typo / legacy: `commissions-api.cj.com` → ENOTFOUND; always normalize to the documented host.
  u = u.replace(/commissions-api\.cj\.com/gi, 'commissions.api.cj.com');
  try {
    const parsed = new URL(u);
    if (parsed.hostname.toLowerCase() === 'commissions-api.cj.com') {
      parsed.hostname = 'commissions.api.cj.com';
    }
    return parsed.toString();
  } catch (_) {
    return DEFAULT_COMMISSIONS_GQL;
  }
}

async function _request(url, token, params) {
  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    try {
      const fullUrl = `${url}?${new URLSearchParams(params)}`;
      const res = await fetch(fullUrl, {
        headers: { Authorization: `Bearer ${token}` },
        signal: AbortSignal.timeout(60000),
      });
      if (res.status === 429) {
        await new Promise(r => setTimeout(r, RETRY_DELAY ** (attempt + 1) * 1000));
        continue;
      }
      if (!res.ok) throw new Error(`${res.status} ${await res.text()}`);
      return await res.json();
    } catch (e) {
      if (attempt === MAX_RETRIES - 1) throw e;
      await new Promise(r => setTimeout(r, RETRY_DELAY ** (attempt + 1) * 1000));
    }
  }
  return {};
}

function _wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function _toIsoStart(dateYmd) {
  return `${String(dateYmd).slice(0, 10)}T00:00:00Z`;
}

function _toIsoEnd(dateYmd) {
  return `${String(dateYmd).slice(0, 10)}T23:59:59Z`;
}

function _pickPublisherId(row = {}) {
  const pid = row.publisherId ?? row.publisher_id ?? row.cid ?? row.pid ?? row.siteId ?? '';
  return String(pid || '').trim();
}

function _normalizePublisherRow(row = {}) {
  const publisher_id = _pickPublisherId(row);
  if (!publisher_id) return null;
  const widRaw = row.websiteId ?? row.website_id ?? row.pid ?? '';
  const wid = String(widRaw || '').trim();
  const website_id =
    wid && wid !== String(publisher_id).trim() ? wid : null;
  const name = row.publisherName ?? row.publisher_name ?? row.name ?? row.websiteName ?? null;
  const domain = row.publisherWebsite ?? row.publisher_website ?? row.domain ?? row.websiteUrl ?? null;
  return {
    publisher_id,
    website_id,
    name: name ? String(name).trim() : null,
    domain: domain ? String(domain).trim() : null,
  };
}

function _extractAdvertiserCidFromDb(merchant) {
  // This codebase's `transactions` table does not store advertiser_id.
  // Keep this helper for parity with Python strategy; no DB source available here.
  return '';
}

function _resolveRequestorCid(merchant) {
  const fromMerchant = String(merchant?.advertiser_id || '').trim();
  if (fromMerchant) return fromMerchant;
  const fromDb = _extractAdvertiserCidFromDb(merchant);
  if (fromDb) return fromDb;
  return String(config.CJ_CID || '').trim();
}

function _cjLog(msg) {
  console.log(`[CJ-fetch-publishers] ${msg}`);
}

/**
 * Publisher Lookup API — ίδια λογική με Python: pagination μέχρι 0 records, χώρα-χώρα.
 * UK δεν δέχεται το API → χρησιμοποιούμε GB.
 */
async function _fetchPublishersByCountry(token, requestorCid, countryCode) {
  const out = [];
  let page = 1;
  let totalMatched = -1;

  while (page <= 500) {
    const params = {
      'requestor-cid': String(requestorCid),
      'page-number': String(page),
      country: countryCode,
    };
    const fullUrl = `${PUBLISHER_LOOKUP_BASE}/joined-publisher-lookup?${new URLSearchParams(params)}`;
    _cjLog(`page ${page} country=${countryCode} requestor-cid=${requestorCid}`);

    const res = await fetch(fullUrl, {
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/xml',
      },
      signal: AbortSignal.timeout(120000),
    });

    const xml = await res.text();
    if (!res.ok) {
      const m = xml.match(/<error-message>([^<]*)<\/error-message>/i);
      const errMsg = (m ? m[1].trim() : xml).slice(0, 300);
      _cjLog(`HTTP ${res.status} country=${countryCode}: ${errMsg}`);
      break;
    }

    let parsed;
    try {
      parsed = xmlParser.parse(xml);
    } catch (e) {
      _cjLog(`XML parse error country=${countryCode}: ${e.message}`);
      break;
    }

    const publishersRoot = parsed?.['cj-api']?.publishers || parsed?.publishers;
    if (!publishersRoot) break;

    const recordsReturned = Number(publishersRoot['records-returned'] || 0);
    const totalMatchedNow = Number(publishersRoot['total-matched'] || 0);
    if (totalMatched < 0) totalMatched = totalMatchedNow;

    const publisherNodes = publishersRoot.publisher
      ? (Array.isArray(publishersRoot.publisher) ? publishersRoot.publisher : [publishersRoot.publisher])
      : [];

    _cjLog(
      `country=${countryCode} page=${page}: ${recordsReturned} records, ${totalMatchedNow} total matched`
    );

    if (!recordsReturned || publisherNodes.length === 0) {
      break;
    }

    for (const node of publisherNodes) {
      const cid = String(node?.cid || '').trim();
      const publisherName = node?.['publisher-name'] ? String(node['publisher-name']).trim() : '';
      const websites = node?.websites?.website
        ? (Array.isArray(node.websites.website) ? node.websites.website : [node.websites.website])
        : [];
      const firstWebsite = websites[0] || {};
      const pid = String(firstWebsite?.pid || '').trim();
      const publisher_id = cid || pid;
      if (!publisher_id) continue;
      const website_id = cid && pid && cid !== pid ? pid : null;

      out.push({
        publisher_id,
        website_id,
        name: publisherName || null,
        domain: firstWebsite?.url ? String(firstWebsite.url).trim() : null,
      });
    }

    if (totalMatched > 0 && out.length >= totalMatched) break;
    page += 1;
  }

  _cjLog(`country=${countryCode}: done, ${out.length} publishers`);
  return out;
}

async function _fetchPublishersFromCommissionDetail(token, requestorCid, start_date, end_date) {
  if (!requestorCid) return [];
  const query = `
    query AdvertiserCommissions($forAdvertisers: [String!]!, $sincePostingDate: String!, $beforePostingDate: String!, $sinceCommissionId: String) {
      advertiserCommissions(
        forAdvertisers: $forAdvertisers
        sincePostingDate: $sincePostingDate
        beforePostingDate: $beforePostingDate
        sinceCommissionId: $sinceCommissionId
      ) {
        count
        payloadComplete
        maxCommissionId
        records {
          publisherId
          publisherName
          websiteId
          websiteName
        }
      }
    }
  `;

  const out = [];
  const seen = new Set();
  let sinceCommissionId = null;
  for (let i = 0; i < 100; i++) {
    const variables = {
      forAdvertisers: [String(requestorCid)],
      sincePostingDate: _toIsoStart(start_date),
      beforePostingDate: _toIsoEnd(end_date),
    };
    if (sinceCommissionId) variables.sinceCommissionId = String(sinceCommissionId);

    const res = await fetch(_getCommissionsGraphqlEndpoint(), {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ query, variables }),
      signal: AbortSignal.timeout(60000),
    });
    if (!res.ok) break;
    const js = await res.json();
    if (Array.isArray(js?.errors) && js.errors.length) break;
    const data = js?.data?.advertiserCommissions;
    if (!data) break;

    const records = Array.isArray(data.records) ? data.records : [];
    for (const r of records) {
      const normalized = _normalizePublisherRow({
        publisherId: r.publisherId,
        publisherName: r.publisherName,
        websiteId: r.websiteId,
        publisherWebsite: r.websiteName,
      });
      if (!normalized) continue;
      if (seen.has(normalized.publisher_id)) continue;
      seen.add(normalized.publisher_id);
      out.push(normalized);
    }

    if (!data.payloadComplete && data.maxCommissionId) {
      sinceCommissionId = data.maxCommissionId;
      await _wait(150);
      continue;
    }
    break;
  }
  return out;
}

function _normCjActionType(t) {
  return String(t || '')
    .toLowerCase()
    .replace(/[^a-z]/g, '');
}

function _instantToYmd(instant) {
  if (!instant) return null;
  const s = String(instant);
  const m = s.match(/^(\d{4}-\d{2}-\d{2})/);
  if (m) return m[1];
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? null : d.toISOString().slice(0, 10);
}

function _moneyGql(v) {
  if (v == null || v === '') return 0;
  const n = parseFloat(String(v).replace(/,/g, ''));
  return Number.isNaN(n) ? 0 : n;
}

function _isOriginalCjCommissionRow(r) {
  if (r?.original === undefined || r?.original === null) return true;
  if (r.original === false || r.original === 0) return false;
  const s = String(r.original).toLowerCase();
  if (s === 'false' || s === '0') return false;
  return true;
}

function _newPerfAgg() {
  return { clicks: 0, impressions: 0, transactions: 0, revenue: 0, commission: 0 };
}

/** CJ GraphQL `actionType`: click, imp, sim_sale, item_sale, sim_lead, item_lead, bonus, perf_inc (commissions.api.cj.com schema). */
function _applyCjCommissionToAgg(agg, r) {
  const t = _normCjActionType(r.actionType);
  const sale = _moneyGql(r.saleAmountUsd);
  const comm = _moneyGql(r.pubCommissionAmountUsd);
  if (t === 'click') {
    agg.clicks += 1;
    agg.commission += comm;
    return;
  }
  if (t === 'imp') {
    agg.impressions += 1;
    agg.commission += comm;
    return;
  }
  agg.transactions += 1;
  agg.revenue += sale;
  agg.commission += comm;
}

const CJ_PERF_SYNC_GQL = `
  query CJPerfSync(
    $forAdvertisers: [String!]!
    $sincePostingDate: String!
    $beforePostingDate: String!
    $sinceCommissionId: String
  ) {
    advertiserCommissions(
      forAdvertisers: $forAdvertisers
      sincePostingDate: $sincePostingDate
      beforePostingDate: $beforePostingDate
      sinceCommissionId: $sinceCommissionId
    ) {
      payloadComplete
      maxCommissionId
      records {
        original
        postingDate
        actionType
        publisherId
        publisherName
        saleAmountUsd
        pubCommissionAmountUsd
      }
    }
  }
`;

/**
 * Ημερήσια metrics από CJ Commission Detail API (GraphQL) — clicks/impressions (ppc/pim),
 * transactions/revenue/commission από sales/leads/bonus κ.λπ.
 * Συμπληρώνει `performance_daily` + `performance_publisher_daily` για το ίδιο date range με το fetch affiliates.
 * Το Scrape (Insights CSV) μπορεί να τρέξει μετά για αριθμούς ακριβώς όπως στο CJ UI.
 */
export async function syncPerformanceFromCommissions(merchant, start_date, end_date) {
  const merchantId = Number(merchant?.id || 0);
  if (!merchantId) return { daily_days: 0, publisher_rows: 0, skipped: 'no_merchant_id' };

  const token = decrypt(merchant.api_token_encrypted || merchant.api_key_encrypted);
  if (!token) return { daily_days: 0, publisher_rows: 0, error: 'CJ API token not configured' };

  const requestorCid = _resolveRequestorCid(merchant);
  if (!requestorCid) return { daily_days: 0, publisher_rows: 0, skipped: 'no_advertiser_cid' };

  const byDay = new Map();
  const byPubDay = new Map();
  let sinceCommissionId = null;
  _cjLog(`syncPerformanceFromCommissions endpoint=${_getCommissionsGraphqlEndpoint()}`);

  for (let page = 0; page < 500; page++) {
    const variables = {
      forAdvertisers: [String(requestorCid)],
      sincePostingDate: _toIsoStart(start_date),
      beforePostingDate: _toIsoEnd(end_date),
    };
    if (sinceCommissionId) variables.sinceCommissionId = String(sinceCommissionId);

    const res = await fetch(_getCommissionsGraphqlEndpoint(), {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ query: CJ_PERF_SYNC_GQL, variables }),
      signal: AbortSignal.timeout(120000),
    });
    if (!res.ok) {
      _cjLog(`syncPerformanceFromCommissions HTTP ${res.status}`);
      break;
    }
    const js = await res.json();
    if (Array.isArray(js?.errors) && js.errors.length) {
      _cjLog(`syncPerformanceFromCommissions GraphQL: ${js.errors.map((e) => e.message).join('; ')}`);
      break;
    }
    const data = js?.data?.advertiserCommissions;
    if (!data) break;

    const records = Array.isArray(data.records) ? data.records : [];
    for (const r of records) {
      if (!_isOriginalCjCommissionRow(r)) continue;
      const dateStr = _instantToYmd(r.postingDate);
      if (!dateStr) continue;

      const dayAgg = byDay.get(dateStr) || _newPerfAgg();
      _applyCjCommissionToAgg(dayAgg, r);
      byDay.set(dateStr, dayAgg);

      const pid = String(r.publisherId || '').trim();
      if (pid) {
        const pkey = `${dateStr}\t${pid}`;
        const pubAgg = byPubDay.get(pkey) || { ..._newPerfAgg(), publisher_name: String(r.publisherName || '').trim() };
        if (r.publisherName) pubAgg.publisher_name = String(r.publisherName).trim();
        _applyCjCommissionToAgg(pubAgg, r);
        byPubDay.set(pkey, pubAgg);
      }
    }

    if (!data.payloadComplete && data.maxCommissionId) {
      sinceCommissionId = data.maxCommissionId;
      await _wait(120);
      continue;
    }
    break;
  }

  const network = 'cj';
  for (const [dateStr, agg] of byDay) {
    db.upsertPerformanceDaily(merchantId, network, dateStr, agg);
  }
  for (const [pkey, pubAgg] of byPubDay) {
    const sep = pkey.indexOf('\t');
    const dateStr = pkey.slice(0, sep);
    const publisherId = pkey.slice(sep + 1);
    db.upsertPerformancePublisherDaily(merchantId, network, dateStr, publisherId, pubAgg.publisher_name || '', {
      clicks: pubAgg.clicks,
      impressions: pubAgg.impressions,
      actions: pubAgg.transactions,
      revenue: pubAgg.revenue,
      commission: pubAgg.commission,
    });
  }

  _cjLog(
    `syncPerformanceFromCommissions: ${byDay.size} performance_daily days, ${byPubDay.size} publisher-day rows (Commission API)`
  );

  return {
    daily_days: byDay.size,
    publisher_rows: byPubDay.size,
    source: 'cj_commission_api',
  };
}

function _fetchPublishersFromTransactionsDb(merchant) {
  const conn = db.getConn();
  const merchantId = Number(merchant?.id || 0);
  const rows = conn.prepare(`
    SELECT DISTINCT publisher_id
    FROM transactions
    WHERE network = 'cj'
      AND merchant_id = ?
      AND publisher_id IS NOT NULL
      AND publisher_id != ''
    ORDER BY publisher_id
  `).all(merchantId);
  const out = [];
  for (const r of rows) {
    const normalized = _normalizePublisherRow({
      publisherId: r.publisher_id,
      publisherName: null,
      publisherWebsite: null,
    });
    if (normalized) out.push(normalized);
  }
  return out;
}

export async function fetchTransactions(merchant, start_date, end_date) {
  const token = decrypt(merchant.api_token_encrypted || merchant.api_key_encrypted);
  if (!token) throw new Error('CJ API token not configured');
  const start_fmt = start_date.replace(/-/g, '');
  const end_fmt = end_date.replace(/-/g, '');
  const url = `${BASE}/commissions/transactions`;
  const data = await _request(url, token, { startDate: start_fmt, endDate: end_fmt });
  if (Array.isArray(data)) return data;
  return data?.transactions || data?.items || data?.data || [];
}

/**
 * Fetch unique publishers/affiliates from CJ (from transactions or publisher lookup).
 * Extracts publisher IDs and names from transaction data and returns list for upsert.
 */
export async function fetchPublishers(merchant, start_date, end_date) {
  const token = decrypt(merchant.api_token_encrypted || merchant.api_key_encrypted);
  if (!token) throw new Error('CJ API token not configured');
  const requestorCid = _resolveRequestorCid(merchant);
  // CJ API: UK απορρίπτεται — χρησιμοποίησε GB (ίδιο με working Python runs)
  const countries = [
    'US',
    'GB',
    'CA',
    'AU',
    'DE',
    'FR',
    'IT',
    'ES',
    'NL',
    'SE',
    'NO',
    'DK',
    'FI',
    'BE',
    'CH',
    'AT',
    'IE',
    'NZ',
    'PL',
    'PT',
    'GR',
    'CZ',
    'HU',
    'RO',
  ];

  const seen = new Set();
  const collected = [];
  const addMany = (rows = []) => {
    for (const r of rows) {
      const normalized = _normalizePublisherRow(r);
      if (!normalized) continue;
      if (seen.has(normalized.publisher_id)) continue;
      seen.add(normalized.publisher_id);
      collected.push(normalized);
    }
  };

  // 1) REST Publisher Lookup by country (Python affiliate_merchant_tool strategy)
  if (requestorCid) {
    _cjLog(`starting Publisher Lookup (requestor-cid=${requestorCid}, ${countries.length} countries)`);
    for (const c of countries) {
      const rows = await _fetchPublishersByCountry(token, requestorCid, c);
      addMany(rows);
    }
    _cjLog(`Publisher Lookup total unique publishers: ${collected.length}`);
    if (collected.length) return collected;
  }

  // 2) GraphQL Commission Detail fallback
  const commissionRows = await _fetchPublishersFromCommissionDetail(token, requestorCid, start_date, end_date);
  addMany(commissionRows);
  if (collected.length) return collected;

  // 3) Transactions fallback
  const txRows = _fetchPublishersFromTransactionsDb(merchant);
  addMany(txRows);
  return collected;
}
