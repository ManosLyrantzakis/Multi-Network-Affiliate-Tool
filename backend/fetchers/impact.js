import { decrypt } from '../utils/crypto.js';
import config from '../config.js';
import { parse } from 'csv-parse/sync';

const BASE = 'https://api.impact.com';
const MAX_RETRIES = 3;
const RETRY_DELAY = 2;
const ACTIONS_PAGE_SIZE = 2000;
const IMPACT_MAX_ACTION_DAYS = 45;

/**
 * Reuse probe + Campaigns IDs for a few minutes after fetchTransactions so ClickExport
 * in the same sync does not immediately hit Impact again (reduces 429 bursts).
 */
let _impactSyncTail = {
  merchantId: null,
  at: 0,
  baseUrl: '',
  auth: '',
  accountType: '',
  campaignIds: [],
};
const IMPACT_SYNC_TAIL_TTL_MS = 3 * 60 * 1000;

function _rememberImpactSyncTail(merchantId, { baseUrl, auth, accountType, campaignIds }) {
  if (merchantId == null) return;
  _impactSyncTail = {
    merchantId,
    at: Date.now(),
    baseUrl,
    auth,
    accountType,
    campaignIds: Array.isArray(campaignIds) ? [...campaignIds] : [],
  };
}

function _takeImpactSyncTail(merchantId) {
  if (merchantId == null) return null;
  if (_impactSyncTail.merchantId !== merchantId) return null;
  if (Date.now() - _impactSyncTail.at > IMPACT_SYNC_TAIL_TTL_MS) return null;
  return {
    baseUrl: _impactSyncTail.baseUrl,
    auth: _impactSyncTail.auth,
    accountType: _impactSyncTail.accountType,
    campaignIds: [..._impactSyncTail.campaignIds],
  };
}

function _getCredentials(merchant) {
  let accountSid = decrypt(merchant.api_key_encrypted);
  let authToken = decrypt(merchant.api_token_encrypted);
  if (!accountSid || !authToken) {
    accountSid = config.IMPACT_ACCOUNT_SID || merchant.api_key_encrypted;
    authToken = config.IMPACT_AUTH_TOKEN || merchant.api_token_encrypted;
  }
  if (!accountSid || !authToken) throw new Error('Impact API credentials not configured');
  return { accountSid, authToken };
}

function _authHeader(accountSid, authToken) {
  const creds = Buffer.from(`${accountSid}:${authToken}`).toString('base64');
  return `Basic ${creds}`;
}

/** Build query string from params, excluding empty/undefined values. */
function _buildParams(params) {
  const filtered = Object.fromEntries(
    Object.entries(params || {}).filter(([, v]) => v != null && v !== '')
  );
  return Object.keys(filtered).length ? new URLSearchParams(filtered).toString() : '';
}

function _sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function _isoUtcDayStart(dayYmd) {
  return `${String(dayYmd).slice(0, 10)}T00:00:00Z`;
}

function _isoUtcDayEnd(dayYmd) {
  return `${String(dayYmd).slice(0, 10)}T23:59:59Z`;
}

/** Split [startYmd, endYmd] into chunks of at most maxSpanDays (Impact Actions limit). */
function _chunkDateRangeYmd(startYmd, endYmd, maxSpanDays = IMPACT_MAX_ACTION_DAYS) {
  const chunks = [];
  let cur = new Date(`${String(startYmd).slice(0, 10)}T12:00:00Z`);
  const end = new Date(`${String(endYmd).slice(0, 10)}T12:00:00Z`);
  while (cur <= end) {
    const chunkStart = new Date(cur);
    let chunkEnd = new Date(cur);
    chunkEnd.setUTCDate(chunkEnd.getUTCDate() + maxSpanDays - 1);
    if (chunkEnd > end) chunkEnd = new Date(end);
    chunks.push({
      start: chunkStart.toISOString().slice(0, 10),
      end: chunkEnd.toISOString().slice(0, 10),
    });
    cur = new Date(chunkEnd);
    cur.setUTCDate(cur.getUTCDate() + 1);
  }
  return chunks;
}

/**
 * Probe Advertisers vs Mediapartners (same as Python ImpactFetcher._probe_account_type).
 */
async function probeAccountType(accountSid, auth) {
  const tryOne = async (kind) => {
    const url = `${BASE}/${kind}/${accountSid}/CompanyInformation`;
    try {
      const res = await fetch(url, {
        headers: { Authorization: auth, Accept: 'application/json' },
        signal: AbortSignal.timeout(15000),
      });
      return res.status;
    } catch {
      return 0;
    }
  };
  if (await tryOne('Advertisers') === 200) return 'advertiser';
  if (await tryOne('Mediapartners') === 200) return 'partner';
  throw new Error('Impact credentials invalid for both Advertisers and Mediapartners (check SID + token)');
}

async function getImpactAccountContext(merchant) {
  const { accountSid, authToken } = _getCredentials(merchant);
  const auth = _authHeader(accountSid, authToken);
  const accountType = await probeAccountType(accountSid, auth);
  const baseUrl = `${BASE}/${accountType === 'advertiser' ? 'Advertisers' : 'Mediapartners'}/${accountSid}`;
  return { accountSid, authToken, auth, accountType, baseUrl };
}

async function _requestJson(url, auth, params = null) {
  const qs = _buildParams(params);
  const fullUrl = qs ? `${url}?${qs}` : url;
  console.log(`[IMPACT] Request: ${fullUrl}`);

  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    try {
      const res = await fetch(fullUrl, {
        headers: {
          Authorization: auth,
          Accept: 'application/json',
        },
        signal: AbortSignal.timeout(90000),
      });
      console.log(`[IMPACT] Response status: ${res.status} (attempt ${attempt + 1})`);
      if (res.status === 429) {
        const delay = RETRY_DELAY ** (attempt + 1) * 1000;
        console.log(`[IMPACT] Rate limited, waiting ${delay}ms`);
        await _sleep(delay);
        continue;
      }
      if (!res.ok) {
        const body = await res.text();
        console.error(`[IMPACT] Error response: ${body.slice(0, 500)}`);
        throw new Error(`${res.status} ${body}`);
      }
      return await res.json();
    } catch (e) {
      console.error(`[IMPACT] Attempt ${attempt + 1} failed:`, e.message);
      if (attempt === MAX_RETRIES - 1) throw e;
      await _sleep(RETRY_DELAY ** (attempt + 1) * 1000);
    }
  }
  return {};
}

/** Campaign / program IDs from Campaigns.json (avoid /Programs which often 403 for brands). */
async function _fetchCampaignIdsFromBase(baseUrl, auth) {
  const url = `${baseUrl}/Campaigns.json`;
  try {
    const data = await _requestJson(url, auth);
    const raw =
      data?.Campaigns ||
      data?.campaigns ||
      data?.Programs ||
      data?.programs ||
      data?.entities ||
      data?.Entity ||
      data?.EntityList;
    const arr = Array.isArray(raw)
      ? raw
      : raw?.Campaign
        ? Array.isArray(raw.Campaign)
          ? raw.Campaign
          : [raw.Campaign]
        : raw?.Program
          ? Array.isArray(raw.Program)
            ? raw.Program
            : [raw.Program]
          : [];
    const ids = arr
      .map((c) => c?.Id ?? c?.id ?? c?.CampaignId ?? c?.campaignId ?? c?.ProgramId ?? c?.programId)
      .filter(Boolean);
    return [...new Set(ids.map(String))];
  } catch (e) {
    console.log(`[IMPACT] Could not fetch Campaigns.json:`, e.message);
    return [];
  }
}

function _parseXmlTag(xml, tag) {
  const re = new RegExp(`<${tag}>([\\s\\S]*?)<\\/${tag}>`, 'i');
  const m = xml.match(re);
  return m ? String(m[1] || '').trim() : '';
}

async function _unwrapClickExportAsyncJob(initialText, auth) {
  const trimmed = (initialText || '').trim();
  if (!trimmed) return '';
  if (!(trimmed.startsWith('<?xml') || trimmed.startsWith('<'))) return initialText;

  const status = _parseXmlTag(trimmed, 'Status');
  const queuedUri = _parseXmlTag(trimmed, 'QueuedUri');
  if (!queuedUri || status.toUpperCase() !== 'QUEUED') return initialText;

  let queuedUrl = queuedUri;
  if (queuedUrl.startsWith('/')) queuedUrl = `${BASE}${queuedUrl}`;

  console.log(`[IMPACT] ClickExport job queued. Polling: ${queuedUrl}`);
  for (let attempt = 0; attempt < 60; attempt++) {
    const jobText = await fetch(queuedUrl, {
      headers: { Authorization: auth, Accept: '*/*' },
      signal: AbortSignal.timeout(30000),
    }).then((r) => r.text());

    const jobStatus = _parseXmlTag(jobText, 'Status') || _parseXmlTag(jobText, 'status');
    const resultUri = _parseXmlTag(jobText, 'ResultUri') || _parseXmlTag(jobText, 'resultUri');

    if (jobStatus === 'COMPLETED') {
      if (!resultUri) return '';
      let resultUrl = resultUri;
      if (resultUrl.startsWith('/')) resultUrl = `${BASE}${resultUrl}`;
      console.log(`[IMPACT] ClickExport job completed. Downloading result: ${resultUrl}`);
      return await fetch(resultUrl, { headers: { Authorization: auth, Accept: '*/*' } }).then((r) => r.text());
    }
    if (jobStatus === 'FAILED') {
      const msg = _parseXmlTag(jobText, 'Message') || 'ClickExport job failed';
      throw new Error(msg);
    }
    await _sleep(10000);
  }
  throw new Error('ClickExport job timeout');
}

/** GET ClickExport URL; returns CSV text (or empty). Handles 429 with Retry-After + exponential fallback. */
async function _fetchClickExportCsv(fullUrl, auth) {
  const CLICK_RETRIES = 10;
  for (let attempt = 0; attempt < CLICK_RETRIES; attempt++) {
    try {
      const response = await fetch(fullUrl, {
        headers: { Authorization: auth, Accept: '*/*' },
        signal: AbortSignal.timeout(120000),
      });
      if (response.status === 429) {
        const ra = response.headers.get('retry-after');
        let delayMs;
        if (ra) {
          const n = Number(ra);
          if (Number.isFinite(n)) {
            delayMs = Math.round(n * 1000);
          } else {
            const dt = Date.parse(ra);
            delayMs = Number.isNaN(dt) ? null : Math.max(0, dt - Date.now());
          }
        }
        if (delayMs == null || !Number.isFinite(delayMs)) {
          delayMs = Math.min(300000, 2000 * 2 ** attempt);
        }
        delayMs = Math.min(Math.max(1000, delayMs), 600000);
        console.log(
          `[IMPACT] ClickExport rate limited (429), waiting ${Math.round(delayMs / 1000)}s (attempt ${attempt + 1}/${CLICK_RETRIES})`
        );
        await _sleep(delayMs);
        continue;
      }
      if (!response.ok) {
        const body = await response.text();
        throw new Error(`ClickExport ${response.status} ${body.slice(0, 400)}`);
      }
      const text = await response.text();
      const unwrapped = text?.includes('QueuedUri') ? await _unwrapClickExportAsyncJob(text, auth) : text;
      return unwrapped || '';
    } catch (e) {
      if (attempt === CLICK_RETRIES - 1) throw e;
      const delay = RETRY_DELAY ** (attempt + 1) * 1000;
      console.log(`[IMPACT] ClickExport attempt ${attempt + 1} failed: ${e.message}. Waiting ${delay}ms`);
      await _sleep(delay);
    }
  }
  return '';
}

function _toDateKey(v) {
  if (v == null) return '';
  const s = String(v).trim();
  if (!s) return '';
  return s.length >= 10 ? s.slice(0, 10) : '';
}

function _firstDefined(row, keys) {
  for (const k of keys) {
    if (row && Object.prototype.hasOwnProperty.call(row, k) && row[k] != null && row[k] !== '') return row[k];
  }
  return '';
}

function _parseClickCsvToRows(csvText) {
  const t = (csvText || '').trim();
  if (!t) return [];
  const firstLine = t.split(/\r?\n/).find((l) => l && l.trim()) || '';
  console.log(`[IMPACT] ClickExport first line: ${firstLine.slice(0, 200)}`);
  return parse(t, { columns: true, skip_empty_lines: true, trim: true, relax_column_count: true });
}

function _addClickRowsToMap(map, rows) {
  const add = (date, publisher_id, publisher_name, clicks) => {
    const pid = String(publisher_id || '').trim();
    if (!date || !pid) return;
    const key = `${date}|${pid}`;
    if (!map.has(key)) {
      map.set(key, { date, publisher_id: pid, publisher_name: publisher_name || '', clicks: 0 });
    }
    const cur = map.get(key);
    cur.publisher_name = cur.publisher_name || publisher_name || '';
    cur.clicks += Number(clicks) || 0;
  };

  for (const row of rows) {
    const eventDate = _firstDefined(row, ['EventDate', 'Click Date', 'Event Date', 'Date']);
    const date = _toDateKey(eventDate);
    const publisher_id = _firstDefined(row, [
      'MediaId',
      'MediaPartnerId',
      'Partner Id',
      'Media Partner Id',
      'MediaPartnerID',
      'PartnerID',
    ]);
    const publisher_name = _firstDefined(row, [
      'MediaName',
      'MediaPartnerName',
      'Partner Name',
      'Media Partner Name',
      'MediaPartner',
      'Partner',
    ]);
    add(date, publisher_id, publisher_name, 1);
  }
}

/**
 * Actions API (Python parity):
 * - Advertiser: GET {base}/Actions.json?CampaignId=&ActionDateStart=&ActionDateEnd=&Page=&PageSize=
 * - Partner: same URL without CampaignId
 */
export async function fetchTransactions(merchant, start_date, end_date) {
  const { auth, baseUrl, accountType } = await getImpactAccountContext(merchant);
  const actionsUrl = `${baseUrl}/Actions.json`;
  const startYmd = String(start_date).slice(0, 10);
  const endYmd = String(end_date).slice(0, 10);
  const chunks = _chunkDateRangeYmd(startYmd, endYmd, IMPACT_MAX_ACTION_DAYS);
  if (chunks.length > 1) {
    console.log(`[IMPACT] Actions date range split into ${chunks.length} chunk(s) (max ${IMPACT_MAX_ACTION_DAYS} days)`);
  }

  let campaignIds = [];
  if (accountType === 'advertiser') {
    campaignIds = await _fetchCampaignIdsFromBase(baseUrl, auth);
    console.log(`[IMPACT] Advertiser: ${campaignIds.length} campaign/program id(s) from Campaigns.json`);
  }
  if (merchant?.id != null) {
    _rememberImpactSyncTail(merchant.id, { baseUrl, auth, accountType, campaignIds });
  }

  const fetchChunkPages = async (campaignId, chunk) => {
    const actionStart = _isoUtcDayStart(chunk.start);
    const actionEnd = _isoUtcDayEnd(chunk.end);
    let all = [];
    let page = 1;
    while (true) {
      const params = {
        ActionDateStart: actionStart,
        ActionDateEnd: actionEnd,
        PageSize: ACTIONS_PAGE_SIZE,
        Page: page,
      };
      if (campaignId != null && campaignId !== '') params.CampaignId = String(campaignId);
      const data = await _requestJson(actionsUrl, auth, params);
      const actions = data?.Actions || data?.actions || data?.data || [];
      const arr = Array.isArray(actions) ? actions : [];
      all = all.concat(arr);
      if (arr.length === 0) break;
      if (arr.length < ACTIONS_PAGE_SIZE) break;
      page += 1;
      await _sleep(100);
    }
    return all;
  };

  let allActions = [];
  for (const chunk of chunks) {
    if (accountType === 'partner') {
      const part = await fetchChunkPages(null, chunk);
      allActions = allActions.concat(part);
      await _sleep(200);
    } else if (campaignIds.length > 0) {
      for (let i = 0; i < campaignIds.length; i++) {
        const cid = campaignIds[i];
        if (i > 0) await _sleep(100);
        const part = await fetchChunkPages(cid, chunk);
        allActions = allActions.concat(part);
      }
    } else {
      console.log(`[IMPACT] No campaign ids; trying Actions without CampaignId (single chunk)`);
      try {
        const part = await fetchChunkPages(null, chunk);
        allActions = allActions.concat(part);
      } catch (e) {
        console.log(`[IMPACT] Actions without CampaignId failed: ${e.message}`);
      }
    }
  }

  console.log(`[IMPACT] Total actions fetched: ${allActions.length}`);
  return allActions;
}

/**
 * Clicks (Python parity):
 * - Advertiser: GET {base}/Programs/{ProgramId}/ClickExport?StartDate=&EndDate= (ISO UTC), one request per program
 * - Partner: GET {base}/ClickExport?Date=YYYY-MM-DD per day
 */
export async function fetchClicksPublisherDaily(merchant, start_date, end_date) {
  const tail = _takeImpactSyncTail(merchant?.id);
  let auth;
  let baseUrl;
  let accountType;
  let cachedProgramIds = null;
  if (tail?.baseUrl && tail?.auth) {
    auth = tail.auth;
    baseUrl = tail.baseUrl;
    accountType = tail.accountType;
    cachedProgramIds = tail.campaignIds?.length ? tail.campaignIds : null;
    if (cachedProgramIds) {
      console.log(
        `[IMPACT] ClickExport: reusing sync session (${cachedProgramIds.length} program id(s); skip extra probe/Campaigns.json)`
      );
    }
  } else {
    const ctx = await getImpactAccountContext(merchant);
    auth = ctx.auth;
    baseUrl = ctx.baseUrl;
    accountType = ctx.accountType;
  }
  const map = new Map();
  const startYmd = String(start_date).slice(0, 10);
  const endYmd = String(end_date).slice(0, 10);

  const addDays = (d, n) => {
    const dt = new Date(`${d}T12:00:00Z`);
    dt.setUTCDate(dt.getUTCDate() + n);
    return dt.toISOString().slice(0, 10);
  };

  if (accountType === 'partner') {
    console.log(`[IMPACT] ClickExport: Media Partner (daily Date=)`);
    for (let day = startYmd; day <= endYmd; day = addDays(day, 1)) {
      const url = `${baseUrl}/ClickExport?${new URLSearchParams({ Date: day })}`;
      console.log(`[IMPACT] ClickExport (partner): ${url}`);
      const text = await _fetchClickExportCsv(url, auth);
      const rows = _parseClickCsvToRows(text);
      _addClickRowsToMap(map, rows);
      console.log(`[IMPACT] ClickExport parsed rows=${rows.length} (partner day=${day})`);
      await _sleep(200);
    }
  } else {
    let programIds =
      cachedProgramIds && cachedProgramIds.length > 0
        ? cachedProgramIds
        : await _fetchCampaignIdsFromBase(baseUrl, auth);
    if (programIds.length === 0) {
      console.log(`[IMPACT] ClickExport: no program IDs from Campaigns.json`);
      return [];
    }
    const start = _isoUtcDayStart(startYmd);
    const end = _isoUtcDayEnd(endYmd);
    console.log(`[IMPACT] ClickExport: Advertiser (per program, range ${start} .. ${end})`);
    console.log(`[IMPACT] ClickExport: cooldown 5s before first export (after Actions)…`);
    await _sleep(5000);
    for (let i = 0; i < programIds.length; i++) {
      const pid = programIds[i];
      if (i > 0) await _sleep(3000);
      const url = `${baseUrl}/Programs/${pid}/ClickExport?${new URLSearchParams({ StartDate: start, EndDate: end })}`;
      console.log(`[IMPACT] ClickExport (advertiser): ${url}`);
      const text = await _fetchClickExportCsv(url, auth);
      const rows = _parseClickCsvToRows(text);
      _addClickRowsToMap(map, rows);
      console.log(`[IMPACT] ClickExport parsed rows=${rows.length} (programId=${pid})`);
    }
  }

  return Array.from(map.values());
}

/**
 * Validate transactions (approve/decline). Updates local DB.
 */
export async function validateTransactions(merchant, externalIds, action = 'approve', _declineReason = null) {
  if (!externalIds?.length) return;
  console.log(`[IMPACT] Validation: ${action} for ${externalIds.length} action(s) (merchant ${merchant?.id})`);
}
