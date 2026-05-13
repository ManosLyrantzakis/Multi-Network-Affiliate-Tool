import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import session from 'express-session';
import { createRequire } from 'module';
import config from './config.js';

const require = createRequire(import.meta.url);
const FileStore = require('session-file-store')(session);
import * as db from './db/index.js';
import { encrypt, decrypt } from './utils/crypto.js';
import * as settings from './utils/settings.js';
import { normalizeTransactions } from './normalization/normalize.js';
import * as awinFetcher from './fetchers/awin.js';
import * as cjFetcher from './fetchers/cj.js';
import * as impactFetcher from './fetchers/impact.js';
import * as webgainsFetcher from './fetchers/webgains.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();

const sessionDir = config.SESSION_STORE_PATH;
if (!fs.existsSync(sessionDir)) fs.mkdirSync(sessionDir, { recursive: true });

app.use(cors({
  origin: ['http://localhost:5173', 'http://127.0.0.1:5173', 'http://localhost:3000', 'http://127.0.0.1:3000'],
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'X-CSRFToken'],
}));
app.use(express.json());
app.use(session({
  store: new FileStore({ path: sessionDir }),
  secret: config.SECRET_KEY,
  resave: false,
  saveUninitialized: false,
  cookie: { secure: false, httpOnly: true, maxAge: 24 * 60 * 60 * 1000 },
}));

function apiResponse(success, data = null, error = null) {
  return { success, data, error };
}

app.get('/api/health', (req, res) => res.json({ ok: true, backend: 'node' }));

app.get('/api/settings', (req, res) => {
  try {
    res.json(apiResponse(true, settings.getSettings()));
  } catch (e) {
    res.status(500).json(apiResponse(false, null, e.message));
  }
});

app.put('/api/settings', (req, res) => {
  try {
    const body = req.body || {};
    const updates = {};
    if (body.schedule_time_utc != null) updates.schedule_time_utc = String(body.schedule_time_utc).slice(0, 5);
    const out = Object.keys(updates).length ? settings.setSettings(updates) : settings.getSettings();
    res.json(apiResponse(true, out));
  } catch (e) {
    res.status(500).json(apiResponse(false, null, e.message));
  }
});

app.use((req, res, next) => {
  console.log(`[${new Date().toISOString()}] ${req.method} ${req.url}`);
  next();
});

// ---- API: Merchants ----
app.get('/api/merchants', (req, res) => {
  try {
    const merchants = db.getMerchants();
    console.log(`[API] GET /api/merchants → ${merchants.length} merchants`);
    res.json(apiResponse(true, merchants));
  } catch (e) {
    console.error('GET /api/merchants:', e);
    res.status(500).json(apiResponse(false, null, e.message));
  }
});

app.post('/api/merchants', (req, res) => {
  try {
    const body = req.body || {};
    const mid = db.createMerchant({
      name: body.name || 'New Merchant',
      network: body.network || 'impact',
      advertiser_id: body.advertiser_id,
      publisher_id: body.publisher_id,
      timezone: body.timezone || 'UTC',
      api_key_encrypted: body.api_key ? encrypt(body.api_key) : null,
      api_token_encrypted: body.api_token ? encrypt(body.api_token) : null,
      commission_rate: body.commission_rate ?? 0,
      commission_fee: body.commission_fee ?? 0,
      basket_rate: body.basket_rate ?? 0,
      fetch_start_date: body.fetch_start_date || null,
      cj_account_name_encrypted: body.cj_account_name ? encrypt(body.cj_account_name) : null,
      cj_password_encrypted: body.cj_password ? encrypt(body.cj_password) : null,
    });
    res.json(apiResponse(true, { id: mid }));
  } catch (e) {
    res.status(500).json(apiResponse(false, null, e.message));
  }
});

// Alias for Next.js - same as /api/transactions
app.get('/api/reports/transactions', (req, res) => {
  try {
    const merchant_id = req.query.merchant_id ? parseInt(req.query.merchant_id, 10) : null;
    const network = req.query.network;
    const status = req.query.status;
    const start_date = req.query.start_date;
    const end_date = req.query.end_date;
    const rows = db.getTransactions({ merchant_id, network, status, start_date, end_date, limit: 1000, offset: 0 });
    const mapped = rows.map((t) => ({
      id: t.id,
      order_id: t.external_id,
      merchant_id: t.merchant_name,
      network: t.network,
      publisher_name: t.publisher_id || '-',
      status: t.status,
      amount: t.amount,
      commission: t.commission,
      sale_date: t.transaction_datetime_utc,
    }));
    res.json(mapped);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Important: these must come BEFORE /api/merchants/:id (otherwise "performance" etc. match :id)
app.get('/api/transactions', (req, res) => {
  try {
    const merchant_id = req.query.merchant_id ? parseInt(req.query.merchant_id, 10) : null;
    const network = req.query.network;
    const status = req.query.status;
    const start_date = req.query.start_date;
    const end_date = req.query.end_date;
    const limit = parseInt(req.query.limit || '500', 10);
    const offset = parseInt(req.query.offset || '0', 10);
    const rows = db.getTransactions({ merchant_id, network, status, start_date, end_date, limit, offset });
    res.json(apiResponse(true, rows));
  } catch (e) {
    res.status(500).json(apiResponse(false, null, e.message));
  }
});

app.get('/api/performance', (req, res) => {
  try {
    const merchant_id = req.query.merchant_id ? parseInt(req.query.merchant_id, 10) : null;
    const stats = db.getMerchantStats(merchant_id);
    res.json(apiResponse(true, stats));
  } catch (e) {
    console.error('GET /api/performance:', e);
    res.status(500).json(apiResponse(false, null, e.message));
  }
});

app.get('/api/performance-daily', (req, res) => {
  try {
    const merchant_id = req.query.merchant_id ? parseInt(req.query.merchant_id, 10) : null;
    const network = req.query.network;
    const start_date = req.query.start_date;
    const end_date = req.query.end_date;
    const rows = db.getPerformanceDaily({ merchant_id, network, start_date, end_date });
    res.json(apiResponse(true, rows));
  } catch (e) {
    res.status(500).json(apiResponse(false, null, e.message));
  }
});

// Publisher-level daily performance (AWIN publisher report, Impact TBD)
app.get('/api/performance-publishers-daily', (req, res) => {
  try {
    const merchant_id = req.query.merchant_id ? parseInt(req.query.merchant_id, 10) : null;
    const network = req.query.network;
    const start_date = req.query.start_date;
    const end_date = req.query.end_date;
    const rows = db.getPerformancePublisherDaily({ merchant_id, network, start_date, end_date });
    res.json(apiResponse(true, rows));
  } catch (e) {
    res.status(500).json(apiResponse(false, null, e.message));
  }
});

// Publisher-level totals across a date range
app.get('/api/performance-publishers', (req, res) => {
  try {
    const merchant_id = req.query.merchant_id ? parseInt(req.query.merchant_id, 10) : null;
    const network = req.query.network;
    const start_date = req.query.start_date;
    const end_date = req.query.end_date;
    const rows = db.getPerformancePublishers({ merchant_id, network, start_date, end_date });
    res.json(apiResponse(true, rows));
  } catch (e) {
    res.status(500).json(apiResponse(false, null, e.message));
  }
});

app.get('/api/dashboard', (req, res) => {
  try {
    const merchant_id = req.query.merchant_id ? parseInt(req.query.merchant_id, 10) : null;
    let merchants = db.getMerchants();
    if (merchant_id) merchants = merchants.filter((m) => m.id === merchant_id);
    const stats = db.getMerchantStats(merchant_id);
    const payload = {
      merchant_count: merchants.length,
      total_count: stats.total_count ?? 0,
      total_revenue: stats.total_revenue ?? 0,
      approved_count: stats.approved_count ?? 0,
      pending_count: stats.pending_count ?? 0,
      declined_count: stats.declined_count ?? 0,
      total_commission: stats.total_commission ?? 0,
    };
    res.json(apiResponse(true, payload));
  } catch (e) {
    res.status(500).json(apiResponse(false, null, e.message));
  }
});

app.get('/api/merchants/:id', (req, res) => {
  try {
    const mid = parseInt(req.params.id, 10);
    const m = db.getMerchant(mid);
    if (!m) return res.status(404).json(apiResponse(false, null, 'Merchant not found'));
    const out = { ...m };
    delete out.api_key_encrypted;
    delete out.api_token_encrypted;
    if (out.cj_account_name_encrypted) out.cj_account_name = decrypt(out.cj_account_name_encrypted);
    delete out.cj_account_name_encrypted;
    delete out.cj_password_encrypted;
    res.json(apiResponse(true, out));
  } catch (e) {
    res.status(500).json(apiResponse(false, null, e.message));
  }
});

app.put('/api/merchants/:id', (req, res) => {
  try {
    const mid = parseInt(req.params.id, 10);
    const body = req.body || {};
    console.log(`[MERCHANT UPDATE] id=${mid}, keys sent:`, Object.keys(body), 'api_key present:', !!body.api_key, 'api_token present:', !!body.api_token);
    const updates = {};
    if (body.api_key) updates.api_key_encrypted = encrypt(body.api_key);
    if (body.api_token) updates.api_token_encrypted = encrypt(body.api_token);
    if (body.cj_account_name !== undefined) updates.cj_account_name_encrypted = body.cj_account_name ? encrypt(body.cj_account_name) : null;
    if (body.cj_password) updates.cj_password_encrypted = encrypt(body.cj_password);
    for (const k of ['name', 'advertiser_id', 'publisher_id', 'timezone', 'commission_rate', 'commission_fee', 'basket_rate', 'fetch_start_date']) {
      if (body[k] !== undefined) updates[k] = body[k];
    }
    console.log(`[MERCHANT UPDATE] Fields to update:`, Object.keys(updates));
    const ok = db.updateMerchant(mid, updates);
    console.log(`[MERCHANT UPDATE] Result:`, ok);
    res.json(apiResponse(true));
  } catch (e) {
    console.error('[MERCHANT UPDATE] Error:', e.message);
    res.status(500).json(apiResponse(false, null, e.message));
  }
});

// ---- API: CJ Publishers (affiliates) ----
app.get('/api/merchants/:id/publishers', (req, res) => {
  try {
    const mid = parseInt(req.params.id, 10);
    const m = db.getMerchant(mid);
    if (!m) return res.status(404).json(apiResponse(false, null, 'Merchant not found'));
    const network = (m.network || '').toLowerCase();
    if (network !== 'cj') return res.json(apiResponse(true, []));
    db.deleteCJPublisherGarbageRows();
    db.deleteCJPublisherNameGarbage();
    const list = db.getCjPublishersWithMetrics(mid, 30);
    res.json(apiResponse(true, list));
  } catch (e) {
    res.status(500).json(apiResponse(false, null, e.message));
  }
});

app.get('/api/merchants/:id/publishers-debug', (req, res) => {
  try {
    const mid = parseInt(req.params.id, 10);
    const days = parseInt(req.query.days, 10) || 30;
    const limit = parseInt(req.query.limit, 10) || 25;
    const m = db.getMerchant(mid);
    if (!m) return res.status(404).json(apiResponse(false, null, 'Merchant not found'));
    const network = (m.network || '').toLowerCase();
    if (network !== 'cj') return res.status(400).json(apiResponse(false, null, 'Only CJ merchants support publishers debug'));
    const debug = db.getCjPublisherMetricsDebug(mid, days, limit);
    res.json(apiResponse(true, debug));
  } catch (e) {
    res.status(500).json(apiResponse(false, null, e.message));
  }
});

/** Live Webgains advertiser KPIs (performance reports), same scope as Program ID(s) on the merchant. */
app.get('/api/merchants/:id/webgains-kpis', async (req, res) => {
  try {
    const mid = parseInt(req.params.id, 10);
    if (!Number.isFinite(mid)) {
      return res.status(400).json(apiResponse(false, null, 'Invalid merchant id'));
    }
    const start_date = req.query.start_date;
    const end_date = req.query.end_date;
    if (!start_date || !end_date) {
      return res.status(400).json(apiResponse(false, null, 'start_date and end_date are required'));
    }
    const m = db.getMerchant(mid);
    if (!m) return res.status(404).json(apiResponse(false, null, 'Merchant not found'));
    if ((m.network || '').toLowerCase() !== 'webgains') {
      return res.status(400).json(apiResponse(false, null, 'Not a Webgains merchant'));
    }
    const data = await webgainsFetcher.getWebgainsKPIs(
      String(start_date).slice(0, 10),
      String(end_date).slice(0, 10),
      null,
      m
    );
    res.json(apiResponse(true, data));
  } catch (e) {
    console.error('[API] GET /api/merchants/:id/webgains-kpis', e);
    res.status(500).json(apiResponse(false, null, e.message || String(e)));
  }
});

app.post('/api/merchants/:id/fetch-publishers', async (req, res) => {
  try {
    const mid = parseInt(req.params.id, 10);
    const m = db.getMerchant(mid);
    if (!m) return res.status(404).json(apiResponse(false, null, 'Merchant not found'));
    const network = (m.network || '').toLowerCase();
    if (network !== 'cj') return res.status(400).json(apiResponse(false, null, 'Only CJ merchants support publisher fetch'));
    // API fetch (Publisher Lookup REST + GraphQL fallback) — NOT scraping.
    const end = new Date();
    const start = new Date();
    start.setDate(start.getDate() - (config.CJ_MAX_DAYS || 60));
    const start_date = m.fetch_start_date ? m.fetch_start_date.slice(0, 10) : start.toISOString().slice(0, 10);
    const end_date = end.toISOString().slice(0, 10);
    const publishers = await cjFetcher.fetchPublishers(m, start_date, end_date);
    for (const p of publishers) {
      db.upsertPublisher('cj', p.publisher_id, p.name, p.domain, p.website_id ?? null);
    }
    db.deleteCJPublisherGarbageRows();
    db.deleteCJPublisherNameGarbage();
    let performance_sync = null;
    try {
      performance_sync = await cjFetcher.syncPerformanceFromCommissions(m, start_date, end_date);
    } catch (syncErr) {
      console.error('CJ syncPerformanceFromCommissions:', syncErr);
      performance_sync = { error: syncErr.message };
    }
    return res.json(apiResponse(true, { count: publishers.length, performance_sync }));
  } catch (e) {
    console.error('Fetch publishers:', e);
    res.status(500).json(apiResponse(false, null, e.message));
  }
});

app.post('/api/merchants/:id/fetch-performance-daily', async (req, res) => {
  try {
    const mid = parseInt(req.params.id, 10);
    const m = db.getMerchant(mid);
    if (!m) return res.status(404).json(apiResponse(false, null, 'Merchant not found'));
    const network = (m.network || '').toLowerCase();
    if (network !== 'cj') return res.status(400).json(apiResponse(false, null, 'Only CJ merchants support performance daily fetch'));
    let runCjPerformanceScraper;
    try {
      const scraperPath = path.join(__dirname, 'scrapers', 'cj-performance.js');
      const scraperHref = new URL(`./scrapers/cj-performance.js?v=${fs.statSync(scraperPath).mtimeMs}`, import.meta.url)
        .href;
      const mod = await import(scraperHref);
      runCjPerformanceScraper = mod.runCjPerformanceScraper;
    } catch (e) {
      return res.status(503).json(apiResponse(false, null, 'CJ Performance scraper requires Playwright. Run: npm install && npx playwright install chromium'));
    }
    const username = m.cj_account_name_encrypted ? decrypt(m.cj_account_name_encrypted) : '';
    const password = m.cj_password_encrypted ? decrypt(m.cj_password_encrypted) : '';
    const advertiser_member_id = m.advertiser_id || config.CJ_CID;
    const body = req.body && typeof req.body === 'object' ? req.body : {};
    const isFirstFetch =
      body.is_first_fetch === true ||
      body.is_first_fetch === 'true' ||
      body.is_first_fetch === 1 ||
      body.is_first_fetch === '1';
    const now = new Date();
    const startDefault = new Date(now);
    startDefault.setDate(startDefault.getDate() - 30);
    const start_date = String(body.date_from || startDefault.toISOString().slice(0, 10)).slice(0, 10);
    const end_date = String(body.date_to || now.toISOString().slice(0, 10)).slice(0, 10);
    const result = await runCjPerformanceScraper({
      username,
      password,
      merchant_id: mid,
      merchant_name: m.name,
      advertiser_member_id,
      date_from: body.date_from || undefined,
      date_to: body.date_to || undefined,
      upsert: (merchant_id, net, date, row) => db.upsertPerformanceDaily(merchant_id, net, date, row),
      upsertPublisherDaily: (merchant_id, net, date, pid, pname, metrics) =>
        db.upsertPerformancePublisherDaily(merchant_id, net, date, pid, pname, metrics),
      is_first_fetch: isFirstFetch,
    });
    const scrapeHasRows =
      !!result?.success && ((Number(result?.publisher_daily_rows || 0) > 0) || (Number(result?.daily_days || 0) > 0));
    if (scrapeHasRows) {
      res.json(
        apiResponse(true, {
          count: result.count,
          daily_days: result.daily_days ?? 0,
          publisher_daily_rows: result.publisher_daily_rows ?? 0,
          source: 'cj_scrape',
        })
      );
    } else {
      // Fallback: if CJ UI export is flaky, fill performance tables from CJ Commission API.
      let performance_sync = null;
      try {
        console.log(`[CJ] scrape returned 0 rows; fallback syncPerformanceFromCommissions range=${start_date}..${end_date}`);
        performance_sync = await cjFetcher.syncPerformanceFromCommissions(m, start_date, end_date);
        console.log(
          `[CJ] fallback syncPerformanceFromCommissions result daily_days=${Number(performance_sync?.daily_days || 0)} publisher_rows=${Number(
            performance_sync?.publisher_rows || 0
          )}`
        );
      } catch (syncErr) {
        console.error('CJ syncPerformanceFromCommissions fallback:', syncErr);
        performance_sync = { error: syncErr.message };
      }
      const syncHasRows =
        (Number(performance_sync?.publisher_rows || 0) > 0) || (Number(performance_sync?.daily_days || 0) > 0);
      if (syncHasRows) {
        return res.json(
          apiResponse(true, {
            count: Number(performance_sync?.publisher_rows || 0),
            daily_days: Number(performance_sync?.daily_days || 0),
            publisher_daily_rows: Number(performance_sync?.publisher_rows || 0),
            source: performance_sync?.source || 'cj_commission_api_fallback',
            scrape_error: result?.error || null,
          })
        );
      }

      // Last-resort fallback: aggregate from transactions table (TXN/REV/COM only, clicks/impressions remain 0).
      try {
        const conn = db.getConn();
        const rows = conn
          .prepare(
            `
            SELECT
              substr(t.transaction_datetime_utc, 1, 10) AS date,
              COALESCE(t.publisher_id, '') AS publisher_id,
              COALESCE(p.name, '') AS publisher_name,
              COUNT(*) AS txns,
              COALESCE(SUM(t.amount), 0) AS revenue,
              COALESCE(SUM(t.commission), 0) AS commission
            FROM transactions t
            LEFT JOIN publishers p
              ON p.network = 'cj'
             AND p.publisher_id = t.publisher_id
            WHERE t.network = 'cj'
              AND t.merchant_id = ?
              AND substr(t.transaction_datetime_utc, 1, 10) >= ?
              AND substr(t.transaction_datetime_utc, 1, 10) <= ?
            GROUP BY substr(t.transaction_datetime_utc, 1, 10), COALESCE(t.publisher_id, ''), COALESCE(p.name, '')
          `
          )
          .all(mid, start_date, end_date);

        if (rows.length) {
          const byDay = new Map();
          for (const r of rows) {
            const d = String(r.date || '').slice(0, 10);
            if (!d) continue;
            const pidRaw = String(r.publisher_id || '').trim();
            const pname = String(r.publisher_name || '').trim();
            const pid = pidRaw || (pname ? `name:${pname.slice(0, 240).replace(/\s+/g, ' ')}` : '');
            const txns = Number(r.txns || 0);
            const revenue = Number(r.revenue || 0);
            const commission = Number(r.commission || 0);
            if (pid) {
              db.upsertPerformancePublisherDaily(mid, 'cj', d, pid, pname, {
                clicks: 0,
                impressions: 0,
                actions: txns,
                revenue,
                commission,
              });
            }
            const agg = byDay.get(d) || { clicks: 0, impressions: 0, transactions: 0, revenue: 0, commission: 0 };
            agg.transactions += txns;
            agg.revenue += revenue;
            agg.commission += commission;
            byDay.set(d, agg);
          }
          for (const [d, agg] of byDay) {
            db.upsertPerformanceDaily(mid, 'cj', d, agg);
          }
          console.log(`[CJ] fallback transactions aggregation rows=${rows.length} days=${byDay.size}`);
          return res.json(
            apiResponse(true, {
              count: rows.length,
              daily_days: byDay.size,
              publisher_daily_rows: rows.length,
              source: 'cj_transactions_fallback',
              scrape_error: result?.error || null,
              sync_error: performance_sync?.error || null,
            })
          );
        }
      } catch (txErr) {
        console.error('CJ transactions fallback failed:', txErr);
      }

      res.status(400).json(apiResponse(false, null, result?.error || performance_sync?.error || 'Scrape failed'));
    }
  } catch (e) {
    console.error('Fetch performance daily:', e);
    res.status(500).json(apiResponse(false, null, e.message));
  }
});

// ---- API: Sync ----
app.post('/api/sync', async (req, res) => {
  try {
    const body = req.body || {};
    const merchant_id = body.merchant_id;
    const end = new Date();
    const start = new Date();
    start.setDate(start.getDate() - 7);
    const start_date = body.start_date || start.toISOString().slice(0, 10);
    const end_date = body.end_date || end.toISOString().slice(0, 10);
    console.log(`[SYNC] Starting sync: merchant_id=${merchant_id || 'ALL'}, range=${start_date} to ${end_date}`);
    if (!start_date || !end_date) {
      return res.status(400).json(apiResponse(false, null, 'start_date and end_date required'));
    }
    let merchants = db.getMerchants();
    if (merchant_id) merchants = merchants.filter(m => m.id === merchant_id);
    console.log(`[SYNC] Merchants to sync: ${merchants.length}`, merchants.map(m => `${m.name}(${m.id},${m.network})`));
    const fetchers = { awin: awinFetcher, cj: cjFetcher, impact: impactFetcher, webgains: webgainsFetcher };
    let total = 0;
    const conn = db.getConn();
    for (const m of merchants) {
      const full = db.getMerchant(m.id);
      if (!full) { console.log(`[SYNC] Merchant ${m.id} not found, skipping`); continue; }
      const net = (full.network || '').toLowerCase();
      const fn = fetchers[net];
      if (!fn) { console.log(`[SYNC] No fetcher for network "${net}", skipping merchant ${m.id}`); continue; }
      const hasKey = !!(full.api_key_encrypted || full.api_token_encrypted);
      console.log(`[SYNC] Fetching merchant ${m.id} (${m.name}) network=${net} hasApiKey=${hasKey}`);
      try {
        const raw = await fn.fetchTransactions(full, start_date, end_date);
        console.log(`[SYNC] Merchant ${m.id}: raw transactions received = ${Array.isArray(raw) ? raw.length : 'not-array'}`);
        const normOpts = {};
        if (net === 'webgains' && config.WEBGAINS_FORCE_ROW_CURRENCY) {
          const frc = String(config.WEBGAINS_FORCE_ROW_CURRENCY).trim().toUpperCase();
          if (/^[A-Z]{3}$/.test(frc)) normOpts.forceRowCurrency = frc;
        }
        const norm = normalizeTransactions(net, raw, full.id, normOpts);
        console.log(`[SYNC] Merchant ${m.id}: normalized = ${norm.length}`);
        for (const n of norm) {
          const dt = n.transaction_datetime_utc || '';
          if (!dt) continue;
          db.upsertTransaction(conn, net, full.id, String(n.external_id || ''), n.amount || 0, n.currency || 'EUR', n.commission || 0, n.status || 'pending', dt, n.click_datetime_utc, n.publisher_id, n.offer_title);
          total++;
        }
        if ((net === 'impact' || net === 'cj' || net === 'webgains') && norm.length > 0) {
          const byDate = {};
          for (const n of norm) {
            const dt = (n.transaction_datetime_utc || '').slice(0, 10);
            if (!dt) continue;
            if (!byDate[dt]) byDate[dt] = { transactions: 0, revenue: 0, commission: 0 };
            byDate[dt].transactions += 1;
            byDate[dt].revenue += Number(n.amount || 0);
            byDate[dt].commission += Number(n.commission || 0);
          }
          for (const [day, agg] of Object.entries(byDate)) {
            db.upsertPerformanceDaily(full.id, net, day, { ...agg, clicks: 0, impressions: 0 });
          }
        }
        if (net === 'webgains' && norm.length > 0 && Array.isArray(raw)) {
          const rawByExt = new Map();
          for (const r of raw) {
            if (!r || typeof r !== 'object') continue;
            const ext = String(r.id ?? r.transaction_id ?? r.order_reference ?? '');
            if (ext) rawByExt.set(ext, r);
          }
          const pubMap = {};
          for (const n of norm) {
            const day = (n.transaction_datetime_utc || '').slice(0, 10);
            if (!day) continue;
            const r = rawByExt.get(String(n.external_id || '')) || {};
            let publisher_id = String(n.publisher_id || '').trim();
            let publisher_name = '';
            const cp = r.campaign?.publisher;
            if (!publisher_id && cp != null && typeof cp === 'object' && cp.id != null && cp.id !== '') {
              publisher_id = String(cp.id);
            }
            if (cp != null && typeof cp === 'object' && cp.name) {
              publisher_name = String(cp.name).trim();
            }
            if (!publisher_id) publisher_id = 'unknown';
            if (!publisher_name) publisher_name = publisher_id;
            const k = `${day}|${publisher_id}`;
            if (!pubMap[k]) {
              pubMap[k] = { day, publisher_id, publisher_name, actions: 0, revenue: 0, commission: 0 };
            }
            pubMap[k].actions += 1;
            pubMap[k].revenue += Number(n.amount || 0);
            pubMap[k].commission += Number(n.commission || 0);
          }
          for (const row of Object.values(pubMap)) {
            db.upsertPerformancePublisherDaily(full.id, net, row.day, row.publisher_id, row.publisher_name, {
              clicks: 0,
              impressions: 0,
              actions: row.actions,
              revenue: row.revenue,
              commission: row.commission,
            });
          }
        }
        if (net === 'impact' && norm.length > 0) { // Impact: clicks via ClickExport + actions via Actions API
          // Build publisher/day aggregates for Impact using:
          // - Clicks from ClickExport (per program) => clicks per MediaPartnerId and date
          // - Actions/revenue/commission from Actions API => actions per publisher and transaction date
          try {
            const actionsByKey = {};
            for (const n of norm) {
              const day = (n.transaction_datetime_utc || '').slice(0, 10);
              if (!day) continue;
              const publisher_id = String(n.publisher_id || '').trim() || 'unknown';
              const k = `${day}|${publisher_id}`;
              if (!actionsByKey[k]) {
                actionsByKey[k] = { day, publisher_id, actions: 0, revenue: 0, commission: 0 };
              }
              actionsByKey[k].actions += 1;
              actionsByKey[k].revenue += Number(n.amount || 0);
              actionsByKey[k].commission += Number(n.commission || 0);
            }

            const clickRows = await impactFetcher.fetchClicksPublisherDaily(full, start_date, end_date);
            console.log(`[SYNC][IMPACT] ClickExport rows aggregated: ${Array.isArray(clickRows) ? clickRows.length : 'not-array'}`);
            const clicksByKey = {};
            const clicksByDay = {};
            for (const r of clickRows || []) {
              const day = String(r.date || '').slice(0, 10);
              const publisher_id = String(r.publisher_id || '').trim();
              if (!day || !publisher_id) continue;
              const k = `${day}|${publisher_id}`;
              if (!clicksByKey[k]) {
                clicksByKey[k] = { day, publisher_id, clicks: 0, publisher_name: r.publisher_name || '' };
              }
              clicksByKey[k].clicks += Number(r.clicks || 0);
              clicksByKey[k].publisher_name = clicksByKey[k].publisher_name || r.publisher_name || '';
              clicksByDay[day] = (clicksByDay[day] || 0) + Number(r.clicks || 0);
            }

            // Keep performance_daily in sync with real Impact clicks so "Clicks by day" shows non-zero values.
            const actionsByDay = {};
            for (const n of norm) {
              const day = (n.transaction_datetime_utc || '').slice(0, 10);
              if (!day) continue;
              if (!actionsByDay[day]) actionsByDay[day] = { transactions: 0, revenue: 0, commission: 0 };
              actionsByDay[day].transactions += 1;
              actionsByDay[day].revenue += Number(n.amount || 0);
              actionsByDay[day].commission += Number(n.commission || 0);
            }
            const dailyKeys = new Set([...Object.keys(actionsByDay), ...Object.keys(clicksByDay)]);
            for (const day of dailyKeys) {
              const a = actionsByDay[day] || { transactions: 0, revenue: 0, commission: 0 };
              db.upsertPerformanceDaily(full.id, net, day, {
                transactions: a.transactions || 0,
                revenue: a.revenue || 0,
                commission: a.commission || 0,
                clicks: clicksByDay[day] || 0,
                impressions: 0,
              });
            }

            const keys = new Set([...Object.keys(actionsByKey), ...Object.keys(clicksByKey)]);
            for (const k of keys) {
              const a = actionsByKey[k];
              const c = clicksByKey[k];
              const day = (c && c.day) || (a && a.day) || '';
              const publisher_id = (c && c.publisher_id) || (a && a.publisher_id) || 'unknown';
              const publisher_name = (c && c.publisher_name) || '';

              if (!day) continue;
              db.upsertPerformancePublisherDaily(full.id, net, day, publisher_id, publisher_name, {
                clicks: (c && c.clicks) || 0,
                impressions: 0, // Impact click export does not provide impressions
                actions: (a && a.actions) || 0,
                revenue: (a && a.revenue) || 0,
                commission: (a && a.commission) || 0,
              });
            }
          } catch (pe) {
            console.error('[SYNC][IMPACT] publisher performance aggregation failed:', pe.message);
          }
        }
        if (net === 'awin' && awinFetcher.fetchPerformance) {
          const s = new Date(start_date);
          const e = new Date(end_date);
          for (let d = new Date(s); d <= e; d.setDate(d.getDate() + 1)) {
            const day = d.toISOString().slice(0, 10);
            try {
              const perfRows = await awinFetcher.fetchPerformance(full, day, day);
              const rows = Array.isArray(perfRows) ? perfRows : [];

              const agg = rows.reduce((a, r) => ({
                clicks: (a.clicks || 0) + Number(r.clicks || 0),
                impressions: (a.impressions || 0) + Number(r.impressions || 0),
                transactions: (a.transactions || 0) + Number(r.totalNo || r.confirmedNo || r.pendingNo || 0),
                revenue: (a.revenue || 0) + Number(r.totalValue || r.confirmedValue || 0),
                commission: (a.commission || 0) + Number(r.totalComm || r.confirmedComm || 0),
              }), {});

              for (const r of rows) {
                // Publisher fields can differ by API response shape; try common variants.
                const publisher_id_raw =
                  r.publisherId ?? r.publisher_id ?? r.publisherID ?? r.PublisherId ?? r.mediaPartnerId ?? r.mediapartnerId ?? r.partnerId ?? r.id ?? '';
                const publisher_name_raw =
                  r.publisherName ?? r.publisher_name ?? r.publisher ?? r.PublisherName ?? r.mediaPartnerName ?? r.mediapartnerName ?? r.partnerName ?? r.name ?? '';

                const publisher_id = String(publisher_id_raw || '').trim() || String(publisher_name_raw || '').trim() || 'unknown';
                const publisher_name = String(publisher_name_raw || '').trim();

                const clicks = Number(r.clicks || 0);
                const impressions = Number(r.impressions || 0);
                const actions = Number(r.totalNo || r.confirmedNo || r.pendingNo || 0);
                const revenue = Number(r.totalValue || r.confirmedValue || r.pendingValue || 0);
                const commission = Number(r.totalComm || r.confirmedComm || r.pendingComm || 0);

                if (clicks || impressions || actions || revenue || commission) {
                  db.upsertPerformancePublisherDaily(full.id, net, day, publisher_id, publisher_name, {
                    clicks,
                    impressions,
                    actions,
                    revenue,
                    commission,
                  });
                }
              }

              if (agg.clicks || agg.impressions || agg.transactions) {
                db.upsertPerformanceDaily(full.id, net, day, agg);
              }
            } catch (pe) { console.error(`[SYNC] Performance ${day}:`, pe.message); }
          }
        }
        console.log(`[SYNC] Merchant ${m.id}: upserted ${total} total so far`);
      } catch (e) {
        console.error(`[SYNC] ERROR merchant ${m.id} (${m.name}, ${net}):`, e.message || e);
      }
    }
    console.log(`[SYNC] Sync complete: ${total} transactions total`);
    res.json(apiResponse(true, { transaction_count: total }));
  } catch (e) {
    console.error('[SYNC] Fatal error:', e);
    res.status(500).json(apiResponse(false, null, e.message));
  }
});

// ---- API: Validation ----
app.post('/api/validation', async (req, res) => {
  try {
    const body = req.body || {};
    const rawIds = (body.transaction_ids || []).map(String).filter(Boolean);
    const action = (body.action || 'approve').toLowerCase();
    const decline_reason = body.decline_reason || body.declineReason || 'declined by user';
    const merchant_id = body.merchant_id ? parseInt(body.merchant_id, 10) : null;
    if (!rawIds.length) {
      return res.status(400).json(apiResponse(false, null, 'transaction_ids required'));
    }
    let rows = db.getTransactionsByIds(rawIds.map(id => parseInt(id, 10)).filter(n => !isNaN(n)));
    if (!rows.length) {
      rows = db.getTransactionsByExternalIds('awin', rawIds, merchant_id || undefined);
    }
    if (!rows.length) {
      rows = db.getTransactionsByExternalIds('impact', rawIds, merchant_id || undefined) || [];
    }
    const byNetworkMerchant = {};
    for (const r of rows) {
      const net = (r.network || '').toLowerCase();
      if (net !== 'awin' && net !== 'impact') continue;
      const key = `${net}:${r.merchant_id}`;
      if (!byNetworkMerchant[key]) byNetworkMerchant[key] = { network: net, merchant_id: r.merchant_id, extIds: [] };
      byNetworkMerchant[key].extIds.push(r.external_id);
    }
    let processed = 0;
    const newStatus = action === 'approve' ? 'approved' : 'declined';
    const conn = db.getConn();
    for (const { network, merchant_id: mid, extIds } of Object.values(byNetworkMerchant)) {
      const m = db.getMerchant(parseInt(mid, 10));
      if (!m) continue;
      if (network === 'awin') {
        await awinFetcher.validateTransactions(m, extIds, action, decline_reason);
      } else if (network === 'impact') {
        await impactFetcher.validateTransactions(m, extIds, action, decline_reason);
      }
      for (const extId of extIds) {
        conn.prepare("UPDATE transactions SET status=?, validated_at_utc=datetime('now') WHERE network=? AND merchant_id=? AND external_id=?")
          .run(newStatus, network, parseInt(mid, 10), extId);
      }
      processed += extIds.length;
    }
    res.json(apiResponse(true, { processed }));
  } catch (e) {
    console.error('[VALIDATION]', e.message);
    res.status(500).json(apiResponse(false, null, e.message));
  }
});

// ---- Serve Vue SPA ----
const distPath = path.join(__dirname, '..', 'frontend', 'dist');
app.use(express.static(distPath));
app.get('*', (req, res) => {
  const index = path.join(distPath, 'index.html');
  if (fs.existsSync(index)) {
    res.sendFile(index);
  } else {
    res.status(404).send('Frontend not built. Run: cd frontend && npm run build');
  }
});

const PORT = process.env.PORT || 5001;
/** Μακρά requests (CJ Playwright scrape ~λεπτά) — αποφυγή πρόωρου κλεισίματος από proxy/HTTP. */
const LONG_HTTP_MS = 15 * 60 * 1000;

function start() {
  const dbDir = path.dirname(config.DATABASE_PATH);
  if (!fs.existsSync(dbDir)) fs.mkdirSync(dbDir, { recursive: true });
  db.initDb();
  const server = app.listen(PORT, '0.0.0.0', () => {
    console.log(`Affiliate Merchant Tool backend at http://localhost:${PORT}`);
  });
  server.timeout = LONG_HTTP_MS;
  server.headersTimeout = LONG_HTTP_MS + 60_000;
  server.keepAliveTimeout = 120_000;
}

start();
