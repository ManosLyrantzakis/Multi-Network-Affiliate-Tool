import Database from 'better-sqlite3';
import path from 'path';
import { fileURLToPath } from 'url';
import config from '../config.js';

const mid = Number(process.argv[2] || 3);
const db = new Database(config.DATABASE_PATH);

const n = db.prepare(`SELECT COUNT(*) AS n FROM performance_publisher_daily WHERE merchant_id = ? AND network = 'cj'`).get(mid);
const sample = db
  .prepare(
    `SELECT date, publisher_id, publisher_name, clicks, impressions, actions, revenue, commission
     FROM performance_publisher_daily WHERE merchant_id = ? AND network = 'cj' ORDER BY date DESC LIMIT 8`
  )
  .all(mid);

const pubs = db.prepare(`SELECT COUNT(*) AS n FROM publishers WHERE network = 'cj'`).get();
const pubSample = db.prepare(`SELECT publisher_id, name FROM publishers WHERE network = 'cj' LIMIT 5`).all();

const pd = db.prepare(`SELECT COUNT(*) AS n FROM performance_daily WHERE merchant_id = ? AND network = 'cj'`).get(mid);
const pdS = db
  .prepare(`SELECT date, clicks, impressions, transactions, revenue, commission FROM performance_daily WHERE merchant_id = ? AND network = 'cj' ORDER BY date DESC LIMIT 5`)
  .all(mid);

console.log(
  JSON.stringify(
    {
      merchant_id: mid,
      performance_publisher_daily_count: n.n,
      performance_daily_count: pd.n,
      sample_ppd: sample,
      sample_performance_daily: pdS,
      publishers_cj: pubs.n,
      pubSample,
    },
    null,
    2
  )
);
