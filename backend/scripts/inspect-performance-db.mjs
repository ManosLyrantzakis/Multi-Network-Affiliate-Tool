import Database from 'better-sqlite3';
import config from '../config.js';

const mid = parseInt(process.argv[2] || '3', 10);
const dbPath = config.DATABASE_PATH;
console.log('DB path:', dbPath);
const db = new Database(dbPath, { readonly: true });

for (const t of ['performance_daily', 'performance_publisher_daily']) {
  const info = db.prepare(`PRAGMA table_info(${t})`).all();
  console.log(`\n${t} columns:`, info.map((c) => `${c.name}:${c.type}`).join(', '));
}

const pd = db.prepare(`SELECT COUNT(*) c FROM performance_daily WHERE merchant_id=? AND network='cj'`).get(mid);
const ppd = db.prepare(`SELECT COUNT(*) c FROM performance_publisher_daily WHERE merchant_id=? AND network='cj'`).get(mid);
console.log(`\nCounts merchant ${mid} / cj: performance_daily=${pd.c}, performance_publisher_daily=${ppd.c}`);

console.log(
  '\nLast performance_daily rows:',
  db.prepare(`SELECT date, clicks, impressions, transactions, revenue, commission FROM performance_daily WHERE merchant_id=? AND network='cj' ORDER BY date DESC LIMIT 8`).all(mid)
);

console.log(
  '\nLast performance_publisher_daily rows:',
  db
    .prepare(
      `SELECT date, publisher_id, substr(publisher_name,1,50) as publisher_name, clicks, revenue FROM performance_publisher_daily WHERE merchant_id=? AND network='cj' ORDER BY date DESC LIMIT 8`
    )
    .all(mid)
);

db.close();
