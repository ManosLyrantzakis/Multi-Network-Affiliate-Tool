import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// Load backend-local .env explicitly so values are available even when npm is run from workspace root.
dotenv.config({ path: path.join(__dirname, '.env') });
// Fallback to default dotenv resolution (.env in process cwd), without overriding already loaded values.
dotenv.config();

export default {
  SECRET_KEY: process.env.SECRET_KEY || 'dev-secret-change-in-production',
  DATABASE_PATH: process.env.DATABASE_PATH
    ? (path.isAbsolute(process.env.DATABASE_PATH)
        ? process.env.DATABASE_PATH
        : path.resolve(__dirname, process.env.DATABASE_PATH))
    : path.join(__dirname, 'data', 'affiliate.db'),
  AWIN_API_TOKEN: process.env.AWIN_API_TOKEN || '',
  AWIN_API_BASE: process.env.AWIN_API_BASE || 'https://api.awin.com',
  AWIN_ADVERTISER_IDS: (process.env.AWIN_ADVERTISER_IDS || '').split(',').map(s => s.trim()).filter(Boolean),
  AWIN_PUBLISHER_ID: process.env.AWIN_PUBLISHER_ID || '',
  AWIN_MAX_DAYS: 31,
  CJ_PAT: process.env.CJ_PAT || '',
  CJ_REST_BASE: process.env.CJ_REST_BASE || 'https://commissions.rakutenadvertising.com',
  CJ_CID: process.env.CJ_CID || '',
  /** CJ Commission GraphQL — hostname must be `commissions.api.cj.com` (hyphenated `commissions-api` does not resolve). */
  CJ_COMMISSIONS_GQL_ENDPOINT: process.env.CJ_COMMISSIONS_GQL_ENDPOINT || '',
  CJ_MAX_DAYS: 60,
  IMPACT_ACCOUNT_SID: process.env.IMPACT_ACCOUNT_SID || '',
  IMPACT_AUTH_TOKEN: process.env.IMPACT_AUTH_TOKEN || '',
  IMPACT_MAX_DAYS: 45,
  WEBGAINS_API_BASE: process.env.WEBGAINS_API_BASE || 'https://platform-api.webgains.com',
  WEBGAINS_CLIENT_ID: process.env.WEBGAINS_CLIENT_ID || '',
  WEBGAINS_CLIENT_SECRET: process.env.WEBGAINS_CLIENT_SECRET || '',
  WEBGAINS_USERNAME: process.env.WEBGAINS_USERNAME || '',
  WEBGAINS_PASSWORD: process.env.WEBGAINS_PASSWORD || '',
  WEBGAINS_MERCHANT_ID: process.env.WEBGAINS_MERCHANT_ID || '',
  WEBGAINS_PROGRAM_IDS: (process.env.WEBGAINS_PROGRAM_IDS || '').split(',').map(s => s.trim()).filter(Boolean),
  /**
   * Optional ISO 4217 code (e.g. DKK). When set, normalized Webgains rows store this as `currency`
   * after sync; amount/commission still use API per-field codes for minor→major conversion.
   * Use when the report is DKK-scoped but some payloads still tag EUR on rows.
   */
  WEBGAINS_FORCE_ROW_CURRENCY: (process.env.WEBGAINS_FORCE_ROW_CURRENCY || '').trim(),
  WEBGAINS_MAX_DAYS: 45,
  SCHEDULE_TIME_UTC: process.env.SCHEDULE_TIME_UTC || '02:00',
  INCREMENTAL_SYNC_HOURS: parseInt(process.env.INCREMENTAL_SYNC_HOURS || '6', 10),
  INCREMENTAL_SYNC_INTERVAL_HOURS: parseInt(process.env.INCREMENTAL_SYNC_INTERVAL_HOURS || process.env.INCREMENTAL_SYNC_HOURS || '6', 10),
  OVERLAP_DAYS: parseInt(process.env.OVERLAP_DAYS || '7', 10),
  SESSION_STORE_PATH: process.env.SESSION_STORE_PATH || path.join(__dirname, 'data', 'sessions'),
  SETTINGS_PATH: process.env.SETTINGS_PATH || path.join(__dirname, 'data', 'settings.json'),
  DEV_STORE_REAL_KEYS: process.env.DEV_STORE_REAL_KEYS === 'true',
};
