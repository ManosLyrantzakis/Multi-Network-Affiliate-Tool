import '../config.js';
import * as db from '../db/index.js';
import * as settings from '../utils/settings.js';
import { normalizeTransactions } from '../normalization/normalize.js';
import * as awinFetcher from '../fetchers/awin.js';
import * as cjFetcher from '../fetchers/cj.js';
import * as impactFetcher from '../fetchers/impact.js';
import * as webgainsFetcher from '../fetchers/webgains.js';
import cron from 'node-cron';
import config from '../config.js';

const fetchers = { awin: awinFetcher, cj: cjFetcher, impact: impactFetcher, webgains: webgainsFetcher };

async function syncMerchant(merchant) {
  const network = (merchant.network || '').toLowerCase();
  const fn = fetchers[network];
  if (!fn) return 0;
  const end = new Date();
  const end_str = end.toISOString().slice(0, 10);
  let start_str;
  if (merchant.fetch_start_date) {
    start_str = merchant.fetch_start_date.slice(0, 10);
  } else {
    const maxDays = network === 'impact'
      ? config.IMPACT_MAX_DAYS
      : network === 'awin'
        ? config.AWIN_MAX_DAYS
        : network === 'webgains'
          ? config.WEBGAINS_MAX_DAYS
          : config.CJ_MAX_DAYS;
    const start = new Date();
    start.setDate(start.getDate() - maxDays);
    start_str = start.toISOString().slice(0, 10);
  }
  const start_utc = new Date().toISOString();
  let count = 0;
  try {
    const raw = await fn.fetchTransactions(merchant, start_str, end_str);
    const normOpts = {};
    if (network === 'webgains' && config.WEBGAINS_FORCE_ROW_CURRENCY) {
      const frc = String(config.WEBGAINS_FORCE_ROW_CURRENCY).trim().toUpperCase();
      if (/^[A-Z]{3}$/.test(frc)) normOpts.forceRowCurrency = frc;
    }
    const norm = normalizeTransactions(network, raw, merchant.id, normOpts);
    const conn = db.getConn();
    for (const n of norm) {
      db.upsertTransaction(conn, network, merchant.id, String(n.external_id || ''), n.amount || 0, n.currency || 'EUR', n.commission || 0, n.status || 'pending', n.transaction_datetime_utc || '', n.click_datetime_utc, n.publisher_id, n.offer_title);
      count++;
    }
    db.logSync(merchant.id, network, start_utc, new Date().toISOString(), count, 'completed');
  } catch (e) {
    console.error('Sync failed merchant', merchant.id, e);
    db.logSync(merchant.id, network, start_utc, new Date().toISOString(), 0, 'failed', String(e));
  }
  return count;
}

async function runIncrementalSync() {
  const merchants = db.getMerchants();
  const full = merchants.map(m => db.getMerchant(m.id)).filter(Boolean);
  for (const m of full) await syncMerchant(m);
  console.log('Incremental sync done.');
}

function getScheduleTime() {
  const s = settings.getSettings();
  return (s && s.schedule_time_utc) || config.SCHEDULE_TIME_UTC || '02:00';
}

let lastDailyRun = null;
cron.schedule('* * * * *', () => {
  const [h, m] = getScheduleTime().split(':').map(x => parseInt(x, 10) || 0);
  const now = new Date();
  if (now.getUTCHours() === h && now.getUTCMinutes() === m) {
    const key = now.toISOString().slice(0, 13);
    if (lastDailyRun !== key) {
      lastDailyRun = key;
      runIncrementalSync();
    }
  }
});
cron.schedule(`0 */${config.INCREMENTAL_SYNC_INTERVAL_HOURS || 6} * * *`, () => runIncrementalSync());
console.log(`Scheduler: daily at ${getScheduleTime()} UTC (from settings), incremental every ${config.INCREMENTAL_SYNC_INTERVAL_HOURS || 6}h`);
