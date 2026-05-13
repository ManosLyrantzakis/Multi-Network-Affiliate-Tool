import Database from 'better-sqlite3';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import config from '../config.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
let db = null;

export function getDb() {
  if (db) return db;
  const dbPath = config.DATABASE_PATH;
  const dir = path.dirname(dbPath);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  db = new Database(dbPath);
  db.pragma('journal_mode = WAL');
  return db;
}

export function getConn() {
  return getDb();
}

function migrateMerchantsNetworkConstraint(database) {
  const merchantSql = database.prepare(`
    SELECT sql
    FROM sqlite_master
    WHERE type='table' AND name='merchants'
  `).get()?.sql || '';
  if (!merchantSql || /['"]webgains['"]/i.test(merchantSql)) return false;

  const merchantColumns = new Set(
    (database.prepare("PRAGMA table_info(merchants)").all() || []).map(c => String(c.name || ''))
  );
  const colOrNull = (name) => (merchantColumns.has(name) ? name : `NULL AS ${name}`);

  const fkRow = database.prepare('PRAGMA foreign_keys').get();
  const previousForeignKeys = Number(Object.values(fkRow || {})[0] || 0);
  try {
    database.exec('PRAGMA foreign_keys = OFF');
    database.exec(`
      BEGIN TRANSACTION;
      CREATE TABLE merchants_new (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        network TEXT NOT NULL CHECK(network IN ('awin', 'cj', 'impact', 'webgains')),
        advertiser_id TEXT,
        publisher_id TEXT,
        timezone TEXT DEFAULT 'UTC',
        api_key_encrypted TEXT,
        api_token_encrypted TEXT,
        commission_rate REAL DEFAULT 0,
        commission_fee REAL DEFAULT 0,
        basket_rate REAL DEFAULT 0,
        last_sync_utc TEXT,
        fetch_start_date TEXT,
        cj_account_name_encrypted TEXT,
        cj_password_encrypted TEXT,
        created_at_utc TEXT DEFAULT (datetime('now')),
        updated_at_utc TEXT DEFAULT (datetime('now'))
      );
      INSERT INTO merchants_new (
        id, name, network, advertiser_id, publisher_id, timezone,
        api_key_encrypted, api_token_encrypted, commission_rate, commission_fee, basket_rate,
        last_sync_utc, fetch_start_date, cj_account_name_encrypted, cj_password_encrypted,
        created_at_utc, updated_at_utc
      )
      SELECT
        ${colOrNull('id')}, ${colOrNull('name')}, ${colOrNull('network')}, ${colOrNull('advertiser_id')}, ${colOrNull('publisher_id')}, ${colOrNull('timezone')},
        ${colOrNull('api_key_encrypted')}, ${colOrNull('api_token_encrypted')}, ${colOrNull('commission_rate')}, ${colOrNull('commission_fee')}, ${colOrNull('basket_rate')},
        ${colOrNull('last_sync_utc')}, ${colOrNull('fetch_start_date')}, ${colOrNull('cj_account_name_encrypted')}, ${colOrNull('cj_password_encrypted')},
        ${colOrNull('created_at_utc')}, ${colOrNull('updated_at_utc')}
      FROM merchants;
      DROP TABLE merchants;
      ALTER TABLE merchants_new RENAME TO merchants;
      COMMIT;
    `);
  } finally {
    database.exec(`PRAGMA foreign_keys = ${previousForeignKeys ? 'ON' : 'OFF'}`);
  }
  return true;
}

export function initDb() {
  const schemaPath = path.join(__dirname, 'schema.sql');
  const schema = fs.readFileSync(schemaPath, 'utf8');
  getDb().exec(schema);
  const database = getDb();
  try { database.exec('ALTER TABLE merchants ADD COLUMN fetch_start_date TEXT'); } catch (_) {}
  try { database.exec('ALTER TABLE merchants ADD COLUMN cj_account_name_encrypted TEXT'); } catch (_) {}
  try { database.exec('ALTER TABLE merchants ADD COLUMN cj_password_encrypted TEXT'); } catch (_) {}
  try { database.exec('ALTER TABLE merchants ADD COLUMN publisher_id TEXT'); } catch (_) {}
  try { database.exec('ALTER TABLE publishers ADD COLUMN website_id TEXT'); } catch (_) {}
  try { database.exec('ALTER TABLE performance_daily ADD COLUMN transactions INTEGER DEFAULT 0'); } catch (_) {}
  try { database.exec("ALTER TABLE performance_daily ADD COLUMN updated_at_utc TEXT DEFAULT (datetime('now'))"); } catch (_) {}
  try {
    migrateMerchantsNetworkConstraint(database);
  } catch (e) {
    try { database.exec('ROLLBACK'); } catch (_) {}
    console.warn('[DB] merchants network migration failed:', e?.message || e);
  }
  try {
    database.exec(`CREATE TABLE IF NOT EXISTS performance_daily (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      merchant_id INTEGER NOT NULL,
      network TEXT NOT NULL,
      date TEXT NOT NULL,
      clicks INTEGER DEFAULT 0,
      impressions INTEGER DEFAULT 0,
      transactions INTEGER DEFAULT 0,
      revenue DECIMAL(12,2) DEFAULT 0,
      commission DECIMAL(12,2) DEFAULT 0,
      created_at_utc TEXT DEFAULT (datetime('now')),
      updated_at_utc TEXT DEFAULT (datetime('now')),
      UNIQUE(merchant_id, network, date),
      FOREIGN KEY (merchant_id) REFERENCES merchants(id)
    )`);
    database.exec('CREATE INDEX IF NOT EXISTS idx_performance_daily_merchant_date ON performance_daily(merchant_id, date)');
  } catch (_) {}
  console.log('Database initialized');
}

export function upsertTransaction(conn, network, merchant_id, external_id, amount, currency, commission, status, transaction_datetime_utc, click_datetime_utc = null, publisher_id = null, offer_title = null) {
  const database = conn || getDb();
  database.prepare(`
    INSERT INTO transactions (network, merchant_id, external_id, amount, currency, commission, status, transaction_datetime_utc, click_datetime_utc, publisher_id, offer_title, updated_at_utc)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
    ON CONFLICT(network, merchant_id, external_id) DO UPDATE SET
      amount=excluded.amount, currency=excluded.currency, commission=excluded.commission, status=excluded.status,
      transaction_datetime_utc=excluded.transaction_datetime_utc, click_datetime_utc=excluded.click_datetime_utc,
      publisher_id=excluded.publisher_id, offer_title=excluded.offer_title, updated_at_utc=datetime('now')
  `).run(network, merchant_id, external_id, parseFloat(amount) || 0, currency || 'EUR', parseFloat(commission) || 0, status, transaction_datetime_utc, click_datetime_utc, publisher_id, offer_title);
  const row = database.prepare('SELECT id FROM transactions WHERE network=? AND merchant_id=? AND external_id=?').get(network, merchant_id, external_id);
  return row ? row.id : 0;
}

export function getTransactionsByIds(ids) {
  if (!ids?.length) return [];
  const database = getDb();
  const placeholders = ids.map(() => '?').join(',');
  return database.prepare(`SELECT t.*, m.name as merchant_name FROM transactions t JOIN merchants m ON t.merchant_id = m.id WHERE t.id IN (${placeholders})`).all(...ids);
}

export function getTransactionsByExternalIds(network, externalIds, merchant_id = null) {
  if (!externalIds?.length) return [];
  const database = getDb();
  const placeholders = externalIds.map(() => '?').join(',');
  let sql = `SELECT t.*, m.name as merchant_name FROM transactions t JOIN merchants m ON t.merchant_id = m.id WHERE t.network=? AND t.external_id IN (${placeholders})`;
  const params = [network, ...externalIds];
  if (merchant_id) { sql += ' AND t.merchant_id=?'; params.push(merchant_id); }
  return database.prepare(sql).all(...params);
}

export function getTransactions({ merchant_id, network, status, start_date, end_date, limit = 500, offset = 0 } = {}) {
  const database = getDb();
  let sql = `SELECT t.*, m.name as merchant_name,
    COALESCE(p.name, t.publisher_id, '') as publisher_name
    FROM transactions t
    JOIN merchants m ON t.merchant_id = m.id
    LEFT JOIN publishers p ON p.network = t.network AND p.publisher_id = t.publisher_id
    WHERE 1=1`;
  const params = [];
  if (merchant_id) { sql += ' AND t.merchant_id = ?'; params.push(merchant_id); }
  if (network) { sql += ' AND t.network = ?'; params.push(network); }
  if (status) { sql += ' AND t.status = ?'; params.push(status); }
  if (start_date) { sql += ' AND t.transaction_datetime_utc >= ?'; params.push(start_date); }
  if (end_date) {
    const ed = String(end_date).trim();
    if (ed.length === 10) {
      sql += " AND t.transaction_datetime_utc < date(?, '+1 day')";
    } else {
      sql += ' AND t.transaction_datetime_utc <= ?';
    }
    params.push(ed);
  }
  sql += ' ORDER BY t.transaction_datetime_utc DESC LIMIT ? OFFSET ?';
  params.push(limit, offset);
  return database.prepare(sql).all(...params);
}

export function getMerchantStats(merchant_id = null) {
  const database = getDb();
  let sql = `SELECT COUNT(*) as total_count,
    COALESCE(SUM(CASE WHEN status='approved' THEN 1 ELSE 0 END), 0) as approved_count,
    COALESCE(SUM(CASE WHEN status='pending' THEN 1 ELSE 0 END), 0) as pending_count,
    COALESCE(SUM(CASE WHEN status='declined' THEN 1 ELSE 0 END), 0) as declined_count,
    COALESCE(SUM(amount), 0) as total_revenue, COALESCE(SUM(commission), 0) as total_commission FROM transactions`;
  const params = [];
  if (merchant_id) { sql += ' WHERE merchant_id = ?'; params.push(merchant_id); }
  const row = database.prepare(sql).get(...params);
  return row || {};
}

export function createMerchant({ name, network, advertiser_id, publisher_id, timezone, api_key_encrypted, api_token_encrypted, commission_rate, commission_fee, basket_rate, fetch_start_date, cj_account_name_encrypted, cj_password_encrypted }) {
  const database = getDb();
  const insert = database.prepare(`
    INSERT INTO merchants (name, network, advertiser_id, publisher_id, timezone, api_key_encrypted, api_token_encrypted, commission_rate, commission_fee, basket_rate, fetch_start_date, cj_account_name_encrypted, cj_password_encrypted)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  const params = [
    name || 'New Merchant',
    network || 'impact',
    advertiser_id || null,
    publisher_id || null,
    timezone || 'UTC',
    api_key_encrypted,
    api_token_encrypted,
    parseFloat(commission_rate) || 0,
    parseFloat(commission_fee) || 0,
    parseFloat(basket_rate) || 0,
    fetch_start_date || null,
    cj_account_name_encrypted,
    cj_password_encrypted,
  ];
  try {
    insert.run(...params);
  } catch (e) {
    const msg = String(e?.message || '');
    if (msg.includes('CHECK constraint failed') && msg.includes("network IN ('awin', 'cj', 'impact')")) {
      migrateMerchantsNetworkConstraint(database);
      insert.run(...params);
    } else {
      throw e;
    }
  }
  return database.prepare('SELECT last_insert_rowid() as id').get().id;
}

export function updateMerchant(merchant_id, updates) {
  const database = getDb();
  const allowed = ['name', 'advertiser_id', 'publisher_id', 'timezone', 'api_key_encrypted', 'api_token_encrypted', 'commission_rate', 'commission_fee', 'basket_rate', 'last_sync_utc', 'fetch_start_date', 'cj_account_name_encrypted', 'cj_password_encrypted'];
  const filtered = {};
  for (const [k, v] of Object.entries(updates)) {
    if (allowed.includes(k) && v !== null && v !== undefined) filtered[k] = v;
  }
  if (Object.keys(filtered).length === 0) return false;
  const sets = Object.keys(filtered).map(k => `${k}=?`).join(', ');
  const params = [...Object.values(filtered), merchant_id];
  database.prepare(`UPDATE merchants SET ${sets}, updated_at_utc=datetime('now') WHERE id=?`).run(...params);
  return true;
}

export function getMerchants() {
  return getDb().prepare(`
    SELECT id, name, network, advertiser_id, timezone, commission_rate, commission_fee, basket_rate, last_sync_utc, fetch_start_date, created_at_utc,
    CASE WHEN api_key_encrypted IS NOT NULL AND api_key_encrypted != '' THEN 1 ELSE 0 END as has_api_key
    FROM merchants ORDER BY name
  `).all();
}

export function getMerchant(merchant_id) {
  return getDb().prepare('SELECT * FROM merchants WHERE id = ?').get(merchant_id) || null;
}

export function logSync(merchant_id, network, start_time_utc, end_time_utc = null, transaction_count = 0, status = 'completed', error_message = null) {
  const database = getDb();
  database.prepare(`
    INSERT INTO sync_logs (merchant_id, network, start_time_utc, end_time_utc, transaction_count, status, error_message) VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(merchant_id, network, start_time_utc, end_time_utc, transaction_count, status, error_message);
  database.prepare('UPDATE merchants SET last_sync_utc = ? WHERE id = ?').run(end_time_utc || start_time_utc, merchant_id);
}

/** Ίδια λογική με performance CSV ώστε το JOIN `publisher_name` ↔ `publishers.name` να ταιριάζει (NFKC, ZW, κενά). */
export function normalizeCjPublisherLabel(s) {
  if (s == null || s === '') return '';
  try {
    return String(s)
      .normalize('NFKC')
      .replace(/[\u200B-\u200D\uFEFF\u2060]/g, '')
      .replace(/\s+/g, ' ')
      .trim();
  } catch (_) {
    return String(s).replace(/\s+/g, ' ').trim();
  }
}

export function upsertPublisher(network, publisher_id, name = null, domain = null, website_id = null) {
  const database = getDb();
  const wid = website_id != null && String(website_id).trim() !== '' ? String(website_id).trim() : null;
  const nName = name != null && String(name).trim() !== '' ? normalizeCjPublisherLabel(String(name)) : name;
  const nDomain = domain != null && String(domain).trim() !== '' ? String(domain).trim() : domain;
  database.prepare(`
    INSERT INTO publishers (network, publisher_id, name, domain, website_id, created_at_utc)
    VALUES (?, ?, ?, ?, ?, datetime('now'))
    ON CONFLICT(network, publisher_id) DO UPDATE SET
      name = COALESCE(excluded.name, publishers.name),
      domain = COALESCE(excluded.domain, publishers.domain),
      website_id = COALESCE(excluded.website_id, publishers.website_id)
  `).run(network, String(publisher_id || ''), nName, nDomain, wid);
}

// CJ Brand Manager/HTML scrapes can occasionally map the wrong cells,
// producing garbage publisher_id like "$29.48 USD".
// Since `publishers` has no merchant_id, we only delete obviously invalid IDs globally.
export function deleteInvalidPublisherIds(network, { minDigits = 4 } = {}) {
  const database = getDb();
  const nd = Number(minDigits) || 4;
  database.prepare(`
    DELETE FROM publishers
    WHERE network = ?
      AND (publisher_id IS NULL OR publisher_id = '' OR length(publisher_id) < ?
           OR publisher_id GLOB '*[^0-9]*')
  `).run(network, nd);
}

// CJ UI filter/header rows sometimes end up as "publisher" entries due to HTML changes.
// Remove obvious label garbage by name to keep the affiliates UI clean.
export function deleteCJPublisherNameGarbage() {
  const database = getDb();
  database.prepare(`
    DELETE FROM publishers
    WHERE network = 'cj'
      AND (
        name LIKE '%Month over Month%'
        OR name LIKE '%Year over Year%'
        OR name LIKE '%Program Terms%'
        OR name LIKE '%Additional Filter Options%'
        OR name LIKE '%Publishers Targeting%'
        OR name LIKE '%Your Recruited%'
      )
  `).run();
}

/**
 * Λάθος mapping (π.χ. scrape): ημερομηνία στο name, ποσό στο domain — όχι πραγματικός publisher.
 */
export function deleteCJPublisherGarbageRows() {
  const database = getDb();
  database.prepare(`
    DELETE FROM publishers
    WHERE network = 'cj'
      AND (
        TRIM(COALESCE(domain, '')) LIKE '$%'
        OR TRIM(COALESCE(domain, '')) GLOB '$[0-9]*'
        OR name GLOB '?-???-????'
        OR name GLOB '??-???-????'
      )
  `).run();
}

/**
 * Affiliates για CJ + άθροισμα metrics τελευταίων N ημερών από performance_publisher_daily (ανά merchant).
 */
export function getCjPublishersWithMetrics(merchant_id, days = 30) {
  const database = getDb();
  const mid = Number(merchant_id);
  if (!mid) return [];
  const mod = `-${Number(days) || 30} days`;
  return database
    .prepare(
      `
    SELECT
      p.id,
      p.network,
      p.publisher_id,
      p.website_id,
      p.name,
      p.domain,
      COALESCE(SUM(ppd.clicks), 0) AS clicks,
      COALESCE(SUM(ppd.impressions), 0) AS impressions,
      COALESCE(SUM(ppd.actions), 0) AS transactions,
      COALESCE(SUM(ppd.revenue), 0) AS revenue,
      COALESCE(SUM(ppd.commission), 0) AS commission
    FROM publishers p
    LEFT JOIN performance_publisher_daily ppd ON
      ppd.network = p.network
      AND ppd.merchant_id = ?
      AND ppd.date >= date('now', ?)
      AND (
        ppd.publisher_id = p.publisher_id
        OR (
          TRIM(COALESCE(p.website_id, '')) != ''
          AND ppd.publisher_id = p.website_id
        )
        OR (
          -- fallback: normalize numeric ids (remove separators) to handle CSV/API formatting variants
          LTRIM(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(LOWER(TRIM(ppd.publisher_id)), ' ', ''), '-', ''), '.', ''), ',', ''), '_', ''), '0')
            = LTRIM(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(LOWER(TRIM(p.publisher_id)), ' ', ''), '-', ''), '.', ''), ',', ''), '_', ''), '0')
        )
        OR (
          TRIM(COALESCE(p.website_id, '')) != ''
          AND LTRIM(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(LOWER(TRIM(ppd.publisher_id)), ' ', ''), '-', ''), '.', ''), ',', ''), '_', ''), '0')
            = LTRIM(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(LOWER(TRIM(p.website_id)), ' ', ''), '-', ''), '.', ''), ',', ''), '_', ''), '0')
        )
        OR (
          -- fallback: scraper may store publisher_id as "name:<publisher name>" (ίδιο κείμενο με CJ Publisher Name)
          ppd.publisher_id LIKE 'name:%'
          AND REPLACE(REPLACE(LOWER(TRIM(COALESCE(ppd.publisher_name, SUBSTR(ppd.publisher_id, 6), ''))), '  ', ' '), '''', '')
            = REPLACE(REPLACE(LOWER(TRIM(COALESCE(p.name, ''))), '  ', ' '), '''', '')
        )
      )
    WHERE p.network = 'cj'
    GROUP BY p.id, p.network, p.publisher_id, p.website_id, p.name, p.domain
    ORDER BY COALESCE(NULLIF(TRIM(p.name), ''), p.publisher_id) COLLATE NOCASE
  `
    )
    .all(mid, mod);
}

export function getCjPublisherMetricsDebug(merchant_id, days = 30, sampleLimit = 25) {
  const database = getDb();
  const mid = Number(merchant_id);
  if (!mid) {
    return {
      merchant_id: mid,
      days: Number(days) || 30,
      totals: {
        publisher_rows: 0,
        metrics_rows: 0,
        matched_metrics_rows: 0,
        unmatched_metrics_rows: 0,
      },
      unmatched_samples: [],
      matched_samples: [],
    };
  }
  const d = Number(days) || 30;
  const mod = `-${d} days`;
  const limit = Math.max(1, Math.min(200, Number(sampleLimit) || 25));

  const totals = database
    .prepare(
      `
    WITH pubs AS (
      SELECT
        p.publisher_id,
        p.website_id,
        p.name,
        LTRIM(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(LOWER(TRIM(COALESCE(p.publisher_id, ''))), ' ', ''), '-', ''), '.', ''), ',', ''), '_', ''), '0') AS pid_norm,
        LTRIM(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(LOWER(TRIM(COALESCE(p.website_id, ''))), ' ', ''), '-', ''), '.', ''), ',', ''), '_', ''), '0') AS wid_norm
      FROM publishers p
      WHERE p.network = 'cj'
    ),
    ppd AS (
      SELECT
        ppd.publisher_id,
        ppd.publisher_name,
        LTRIM(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(LOWER(TRIM(COALESCE(ppd.publisher_id, ''))), ' ', ''), '-', ''), '.', ''), ',', ''), '_', ''), '0') AS pid_norm
      FROM performance_publisher_daily ppd
      WHERE ppd.network = 'cj'
        AND ppd.merchant_id = ?
        AND ppd.date >= date('now', ?)
    ),
    ppd_match AS (
      SELECT
        ppd.publisher_id,
        ppd.publisher_name,
        EXISTS (
          SELECT 1
          FROM pubs p
          WHERE
            ppd.publisher_id = p.publisher_id
            OR (TRIM(COALESCE(p.website_id, '')) != '' AND ppd.publisher_id = p.website_id)
            OR (ppd.pid_norm != '' AND ppd.pid_norm = p.pid_norm)
            OR (TRIM(COALESCE(p.website_id, '')) != '' AND ppd.pid_norm != '' AND ppd.pid_norm = p.wid_norm)
            OR (
              ppd.publisher_id LIKE 'name:%'
              AND REPLACE(REPLACE(LOWER(TRIM(COALESCE(ppd.publisher_name, SUBSTR(ppd.publisher_id, 6), ''))), '  ', ' '), '''', '')
                = REPLACE(REPLACE(LOWER(TRIM(COALESCE(p.name, ''))), '  ', ' '), '''', '')
            )
        ) AS is_matched
      FROM ppd
    )
    SELECT
      (SELECT COUNT(*) FROM pubs) AS publisher_rows,
      (SELECT COUNT(*) FROM ppd) AS metrics_rows,
      (SELECT COUNT(*) FROM ppd_match WHERE is_matched = 1) AS matched_metrics_rows,
      (SELECT COUNT(*) FROM ppd_match WHERE is_matched = 0) AS unmatched_metrics_rows
  `
    )
    .get(mid, mod);

  const unmatched_samples = database
    .prepare(
      `
    WITH pubs AS (
      SELECT
        p.publisher_id,
        p.website_id,
        p.name,
        LTRIM(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(LOWER(TRIM(COALESCE(p.publisher_id, ''))), ' ', ''), '-', ''), '.', ''), ',', ''), '_', ''), '0') AS pid_norm,
        LTRIM(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(LOWER(TRIM(COALESCE(p.website_id, ''))), ' ', ''), '-', ''), '.', ''), ',', ''), '_', ''), '0') AS wid_norm
      FROM publishers p
      WHERE p.network = 'cj'
    ),
    ppd AS (
      SELECT
        ppd.publisher_id,
        MAX(ppd.publisher_name) AS publisher_name,
        SUM(ppd.clicks) AS clicks,
        SUM(ppd.impressions) AS impressions,
        SUM(ppd.actions) AS actions,
        SUM(ppd.revenue) AS revenue,
        SUM(ppd.commission) AS commission,
        MAX(ppd.date) AS last_date,
        LTRIM(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(LOWER(TRIM(COALESCE(ppd.publisher_id, ''))), ' ', ''), '-', ''), '.', ''), ',', ''), '_', ''), '0') AS pid_norm
      FROM performance_publisher_daily ppd
      WHERE ppd.network = 'cj'
        AND ppd.merchant_id = ?
        AND ppd.date >= date('now', ?)
      GROUP BY ppd.publisher_id
    )
    SELECT
      ppd.publisher_id,
      ppd.publisher_name,
      ppd.last_date,
      ppd.clicks,
      ppd.impressions,
      ppd.actions,
      ppd.revenue,
      ppd.commission
    FROM ppd
    WHERE NOT EXISTS (
      SELECT 1
      FROM pubs p
      WHERE
        ppd.publisher_id = p.publisher_id
        OR (TRIM(COALESCE(p.website_id, '')) != '' AND ppd.publisher_id = p.website_id)
        OR (ppd.pid_norm != '' AND ppd.pid_norm = p.pid_norm)
        OR (TRIM(COALESCE(p.website_id, '')) != '' AND ppd.pid_norm != '' AND ppd.pid_norm = p.wid_norm)
        OR (
          ppd.publisher_id LIKE 'name:%'
          AND REPLACE(REPLACE(LOWER(TRIM(COALESCE(ppd.publisher_name, SUBSTR(ppd.publisher_id, 6), ''))), '  ', ' '), '''', '')
            = REPLACE(REPLACE(LOWER(TRIM(COALESCE(p.name, ''))), '  ', ' '), '''', '')
        )
    )
    ORDER BY ppd.commission DESC, ppd.revenue DESC, ppd.actions DESC
    LIMIT ?
  `
    )
    .all(mid, mod, limit);

  const matched_samples = database
    .prepare(
      `
    SELECT
      p.publisher_id,
      p.website_id,
      p.name,
      p.domain,
      COALESCE(SUM(ppd.clicks), 0) AS clicks,
      COALESCE(SUM(ppd.impressions), 0) AS impressions,
      COALESCE(SUM(ppd.actions), 0) AS actions,
      COALESCE(SUM(ppd.revenue), 0) AS revenue,
      COALESCE(SUM(ppd.commission), 0) AS commission
    FROM publishers p
    LEFT JOIN performance_publisher_daily ppd ON
      ppd.network = p.network
      AND ppd.merchant_id = ?
      AND ppd.date >= date('now', ?)
      AND (
        ppd.publisher_id = p.publisher_id
        OR (
          TRIM(COALESCE(p.website_id, '')) != ''
          AND ppd.publisher_id = p.website_id
        )
        OR (
          LTRIM(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(LOWER(TRIM(ppd.publisher_id)), ' ', ''), '-', ''), '.', ''), ',', ''), '_', ''), '0')
            = LTRIM(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(LOWER(TRIM(p.publisher_id)), ' ', ''), '-', ''), '.', ''), ',', ''), '_', ''), '0')
        )
        OR (
          TRIM(COALESCE(p.website_id, '')) != ''
          AND LTRIM(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(LOWER(TRIM(ppd.publisher_id)), ' ', ''), '-', ''), '.', ''), ',', ''), '_', ''), '0')
            = LTRIM(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(LOWER(TRIM(p.website_id)), ' ', ''), '-', ''), '.', ''), ',', ''), '_', ''), '0')
        )
        OR (
          ppd.publisher_id LIKE 'name:%'
          AND REPLACE(REPLACE(LOWER(TRIM(COALESCE(ppd.publisher_name, SUBSTR(ppd.publisher_id, 6), ''))), '  ', ' '), '''', '')
            = REPLACE(REPLACE(LOWER(TRIM(COALESCE(p.name, ''))), '  ', ' '), '''', '')
        )
      )
    WHERE p.network = 'cj'
    GROUP BY p.id, p.publisher_id, p.website_id, p.name, p.domain
    HAVING
      COALESCE(SUM(ppd.clicks), 0) > 0
      OR COALESCE(SUM(ppd.impressions), 0) > 0
      OR COALESCE(SUM(ppd.actions), 0) > 0
      OR COALESCE(SUM(ppd.revenue), 0) > 0
      OR COALESCE(SUM(ppd.commission), 0) > 0
    ORDER BY commission DESC, revenue DESC, actions DESC
    LIMIT ?
  `
    )
    .all(mid, mod, limit);

  return {
    merchant_id: mid,
    days: d,
    totals: {
      publisher_rows: Number(totals?.publisher_rows || 0),
      metrics_rows: Number(totals?.metrics_rows || 0),
      matched_metrics_rows: Number(totals?.matched_metrics_rows || 0),
      unmatched_metrics_rows: Number(totals?.unmatched_metrics_rows || 0),
    },
    unmatched_samples,
    matched_samples,
  };
}

export function getPublishersByNetwork(network, merchant_id = null) {
  const database = getDb();
  if (merchant_id) {
    const rows = database.prepare(`
      SELECT DISTINCT p.id, p.network, p.publisher_id, p.name, p.domain
      FROM publishers p
      WHERE p.network = ?
      ORDER BY p.name, p.publisher_id
    `).all(network);
    return rows;
  }
  return database.prepare(`
    SELECT id, network, publisher_id, name, domain FROM publishers WHERE network = ? ORDER BY name, publisher_id
  `).all(network);
}

export function upsertPerformanceDaily(merchant_id, network, date, { clicks = 0, impressions = 0, transactions = 0, revenue = 0, commission = 0 } = {}) {
  const database = getDb();
  database.prepare(`
    INSERT INTO performance_daily (merchant_id, network, date, clicks, impressions, transactions, revenue, commission, updated_at_utc)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
    ON CONFLICT(merchant_id, network, date) DO UPDATE SET
      clicks=excluded.clicks, impressions=excluded.impressions, transactions=excluded.transactions,
      revenue=excluded.revenue, commission=excluded.commission, updated_at_utc=datetime('now')
  `).run(merchant_id, network, String(date).slice(0, 10), Number(clicks) || 0, Number(impressions) || 0, Number(transactions) || 0, parseFloat(revenue) || 0, parseFloat(commission) || 0);
}

export function upsertPerformancePublisherDaily(
  merchant_id,
  network,
  date,
  publisher_id,
  publisher_name = '',
  { clicks = 0, impressions = 0, actions = 0, revenue = 0, commission = 0 } = {}
) {
  const database = getDb();
  let pid = String(publisher_id || '');
  if (/^name:/i.test(pid)) {
    const rest = pid.slice(5);
    pid = `name:${normalizeCjPublisherLabel(rest).slice(0, 240)}`;
  }
  const pname = normalizeCjPublisherLabel(String(publisher_name || ''));
  database.prepare(`
    INSERT INTO performance_publisher_daily (
      merchant_id, network, date, publisher_id, publisher_name,
      clicks, impressions, actions, revenue, commission, updated_at_utc
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
    ON CONFLICT(merchant_id, network, date, publisher_id) DO UPDATE SET
      publisher_name = COALESCE(excluded.publisher_name, performance_publisher_daily.publisher_name),
      clicks=excluded.clicks,
      impressions=excluded.impressions,
      actions=excluded.actions,
      revenue=excluded.revenue,
      commission=excluded.commission,
      updated_at_utc=datetime('now')
  `).run(
    merchant_id,
    network,
    String(date).slice(0, 10),
    pid,
    pname,
    Number(clicks) || 0,
    Number(impressions) || 0,
    Number(actions) || 0,
    parseFloat(revenue) || 0,
    parseFloat(commission) || 0
  );
}

export function getPerformanceDaily({ merchant_id, network, start_date, end_date } = {}) {
  const database = getDb();
  let sql = `SELECT pd.*, m.name as merchant_name
    FROM performance_daily pd
    JOIN merchants m ON m.id = pd.merchant_id
    WHERE 1=1`;
  const params = [];
  if (merchant_id) { sql += ' AND pd.merchant_id = ?'; params.push(merchant_id); }
  if (network) { sql += ' AND pd.network = ?'; params.push(network); }
  if (start_date) { sql += ' AND pd.date >= ?'; params.push(start_date); }
  if (end_date) { sql += ' AND pd.date <= ?'; params.push(end_date); }
  sql += ' ORDER BY pd.date DESC';
  return database.prepare(sql).all(...params);
}

export function getPerformancePublisherDaily({ merchant_id, network, start_date, end_date } = {}) {
  const database = getDb();
  let sql = `SELECT pd.date, pd.network, pd.publisher_id, pd.publisher_name,
    pd.clicks, pd.impressions, pd.actions, pd.revenue, pd.commission
    FROM performance_publisher_daily pd
    WHERE 1=1`;
  const params = [];
  if (merchant_id) { sql += ' AND pd.merchant_id = ?'; params.push(merchant_id); }
  if (network) { sql += ' AND pd.network = ?'; params.push(network); }
  if (start_date) { sql += ' AND pd.date >= ?'; params.push(start_date); }
  if (end_date) { sql += ' AND pd.date <= ?'; params.push(end_date); }
  sql += ' ORDER BY pd.date DESC';
  return database.prepare(sql).all(...params);
}

export function getPerformancePublishers({ merchant_id, network, start_date, end_date } = {}) {
  const database = getDb();
  let sql = `SELECT
      pd.network,
      pd.publisher_id,
      COALESCE(pd.publisher_name, pd.publisher_id, '') AS publisher_name,
      SUM(pd.clicks) AS clicks,
      SUM(pd.impressions) AS impressions,
      SUM(pd.actions) AS actions,
      SUM(pd.revenue) AS revenue,
      SUM(pd.commission) AS commission
    FROM performance_publisher_daily pd
    WHERE 1=1`;
  const params = [];
  if (merchant_id) { sql += ' AND pd.merchant_id = ?'; params.push(merchant_id); }
  if (network) { sql += ' AND pd.network = ?'; params.push(network); }
  if (start_date) { sql += ' AND pd.date >= ?'; params.push(start_date); }
  if (end_date) { sql += ' AND pd.date <= ?'; params.push(end_date); }
  sql += `
    GROUP BY pd.network, pd.publisher_id, COALESCE(pd.publisher_name, pd.publisher_id)
    ORDER BY revenue DESC`;
  return database.prepare(sql).all(...params);
}
