/**
 * AWIN Publisher/Advertiser API - Official docs: https://developer.awin.com/
 * - Transactions: GET /advertisers/{id}/transactions or GET /publishers/{id}/transactions
 * - Performance (clicks, impressions): GET /advertisers/{id}/reports/publisher
 * - Validation: POST /advertisers/{id}/transactions/batch
 * Auth: Bearer token. Max 31 days per request. Date format: yyyy-MM-ddThh:mm:ss
 */
import { decrypt } from '../utils/crypto.js';
import config from '../config.js';

const BASE = config.AWIN_API_BASE || 'https://api.awin.com';
const MAX_RETRIES = 3;
const RETRY_DELAY = 2;
const MAX_DATE_RANGE_DAYS = 31;
const DEFAULT_TIMEZONE = 'UTC';

async function _request(url, token, params = null) {
  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    try {
      const fullUrl = params ? `${url}?${new URLSearchParams(params)}` : url;
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
  return null;
}

function toAwinDateTime(dateStr) {
  if (!dateStr) return null;
  const d = dateStr.includes('T') ? dateStr : `${dateStr}T00:00:00`;
  return d.endsWith('Z') ? d : d.replace(/Z?$/, '');
}

function chunkDateRange(startDate, endDate) {
  const chunks = [];
  let s = new Date(startDate);
  const e = new Date(endDate);
  while (s <= e) {
    const chunkEnd = new Date(s);
    chunkEnd.setDate(chunkEnd.getDate() + MAX_DATE_RANGE_DAYS - 1);
    const actualEnd = chunkEnd > e ? e : chunkEnd;
    chunks.push({
      start: s.toISOString().slice(0, 10),
      end: actualEnd.toISOString().slice(0, 10),
    });
    s = new Date(actualEnd);
    s.setDate(s.getDate() + 1);
  }
  return chunks;
}

function getAccountId(merchant) {
  const publisherId = merchant.publisher_id || config.AWIN_PUBLISHER_ID;
  const advertiserId = merchant.advertiser_id || (config.AWIN_ADVERTISER_IDS?.[0]);
  if (advertiserId) return { type: 'advertiser', id: String(advertiserId).trim() };
  if (publisherId) return { type: 'publisher', id: String(publisherId).trim() };
  return null;
}

/**
 * Fetch transactions. Supports both Publisher and Advertiser API.
 * - Advertiser: GET /advertisers/{advertiserId}/transactions/
 * - Publisher: GET /publishers/{publisherId}/transactions
 */
export async function fetchTransactions(merchant, start_date, end_date, advertiser_ids = null) {
  const token = decrypt(merchant.api_key_encrypted) || merchant.api_key_encrypted;
  if (!token) throw new Error('AWIN API token not configured');

  const account = getAccountId(merchant);
  if (!account) throw new Error('AWIN advertiser_id or publisher_id required');

  const timezone = merchant.timezone || DEFAULT_TIMEZONE;
  const advertiserIds = advertiser_ids || (merchant.advertiser_id ? [String(merchant.advertiser_id).trim()] : []) || config.AWIN_ADVERTISER_IDS || [];
  const all = [];

  const chunks = chunkDateRange(start_date, end_date);

  for (const { start, end } of chunks) {
    const startDt = `${start}T00:00:00`;
    const endDt = `${end}T23:59:59`;

    const params = {
      startDate: startDt,
      endDate: endDt,
      timezone,
      dateType: 'transaction',
    };
    if (account.type === 'publisher' && advertiserIds.length) {
      params.advertiserId = advertiserIds.join(',');
    }
    if (account.type === 'advertiser' && merchant.publisher_id) {
      params.publisherId = String(merchant.publisher_id);
    }

    let url;
    if (account.type === 'publisher') {
      url = `${BASE}/publishers/${account.id}/transactions/`;
    } else {
      url = `${BASE}/advertisers/${account.id}/transactions/`;
    }

    const data = await _request(url, token, params);
    if (Array.isArray(data)) {
      all.push(...data);
    } else if (data?.transactions) {
      all.push(...data.transactions);
    } else if (data?.data) {
      all.push(...(Array.isArray(data.data) ? data.data : []));
    } else if (data?.pageItems) {
      all.push(...data.pageItems);
    }
  }

  return all;
}

/**
 * Fetch publisher performance (clicks, impressions, transactions) - Advertiser API only.
 * GET /advertisers/{advertiserId}/reports/publisher
 */
export async function fetchPerformance(merchant, start_date, end_date) {
  const token = decrypt(merchant.api_key_encrypted) || merchant.api_key_encrypted;
  if (!token) throw new Error('AWIN API token not configured');

  const advertiserId = merchant.advertiser_id || config.AWIN_ADVERTISER_IDS?.[0];
  if (!advertiserId) throw new Error('AWIN advertiser_id required for performance report');

  const timezone = merchant.timezone || DEFAULT_TIMEZONE;
  const url = `${BASE}/advertisers/${advertiserId}/reports/publisher`;
  const startDay = String(start_date).slice(0, 10);
  const endDay = String(end_date).slice(0, 10);
  const paramsDateOnly = {
    startDate: startDay,
    endDate: endDay,
    timezone,
    dateType: 'transaction',
  };
  const paramsDateTime = {
    startDate: `${startDay}T00:00:00`,
    endDate: `${endDay}T23:59:59`,
    timezone,
    dateType: 'transaction',
  };

  let data;
  try {
    // Some AWIN accounts expect plain date for reports/publisher.
    data = await _request(url, token, paramsDateOnly);
  } catch (e) {
    const msg = String(e?.message || e || '');
    if (!msg.includes('type.mismatch')) throw e;
    // Fallback for accounts expecting datetime format.
    data = await _request(url, token, paramsDateTime);
  }
  let rows = data?.body || data?.data || data;
  if (!Array.isArray(rows)) rows = rows && typeof rows === 'object' ? Object.values(rows).flat().filter(Boolean) : [];
  return Array.isArray(rows) ? rows : [];
}

/**
 * Validate transactions (approve/decline) - Advertiser API only.
 * POST /advertisers/{advertiserId}/transactions/batch
 */
export async function validateTransactions(merchant, transactionIds, action = 'approve', declineReason = null) {
  const token = decrypt(merchant.api_key_encrypted) || merchant.api_key_encrypted;
  if (!token) throw new Error('AWIN API token not configured');

  const advertiserId = merchant.advertiser_id || config.AWIN_ADVERTISER_IDS?.[0];
  if (!advertiserId) throw new Error('AWIN advertiser_id required for validation');

  const timezone = merchant.timezone || DEFAULT_TIMEZONE;
  const url = `${BASE}/advertisers/${advertiserId}/transactions/batch`;

  const batch = transactionIds.map(id => {
    const tx = { transactionId: String(id) };
    if (action === 'approve') {
      return { action: 'approve', transaction: tx };
    }
    if (action === 'decline') {
      tx.declineReason = declineReason || 'declined by user';
      return { action: 'decline', transaction: tx };
    }
    return { action: 'approve', transaction: tx };
  });

  const res = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(batch),
    signal: AbortSignal.timeout(60000),
  });

  if (!res.ok) throw new Error(`${res.status} ${await res.text()}`);
  return await res.json();
}
