/**
 * CJ Performance + Reports scraper (Playwright) — 1:1 με τον πίνακα βημάτων
 * fetch_performance_daily_via_scraping: login → Reports → Performance → Select2 (Publisher / Daily / Last 30) → Run → CSV download → DB.
 * (Δεν κατεβάζει πλέον ξεχωριστό Transactions report — μόνο Performance CSV.)
 * Member id στο URL: από session/merchant (το 6222950 στο spec είναι παράδειγμα).
 */

import { chromium } from 'playwright';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { parse } from 'csv-parse/sync';
import { normalizeCjPublisherLabel } from '../db/index.js';

const PERFORMANCE_HASH = '#?tab=performance';

/** Python order: homepage first */
const LOGIN_URLS = ['https://www.cj.com/', 'https://members.cj.com/member/login/#/', 'https://members.cj.com/'];

/** Φάση 1.1 — ίδια σειρά με Python: LINK_TEXT → PARTIAL_LINK_TEXT → XPath → CSS (μετά string selectors) */
const LOGIN_LINK_STRING_SELECTORS = [
  'a:has-text("Login")',
  'xpath=//a[contains(text(), "Login")]',
  'a[href*="login"]',
  'a[href*="Login"]',
];

const USERNAME_SELECTORS = [
  '#username',
  '#email',
  'input[name="username"]',
  'input[name="email"]',
  'input[type="email"]',
  'input[type="text"][name*="user"]',
  'input[type="text"][name*="email"]',
  'input[placeholder*="email" i]',
  'input[placeholder*="Email" i]',
  'input[placeholder*="username" i]',
  'input[placeholder*="Username" i]',
  'xpath=//input[@type="email" or @type="text"]',
  'xpath=//input[contains(@placeholder, "email") or contains(@placeholder, "Email")]',
];

const NEXT_BUTTON_SELECTORS = [
  'xpath=//button[contains(text(), "Next") or contains(text(), "Continue") or contains(text(), "next") or contains(text(), "Sign in")]',
  'button[type="submit"]',
  'input[type="submit"]',
  '#okta-signin-submit',
  '#next',
  '#continue',
  'button[class*="next"]',
  'button[class*="continue"]',
  'button[class*="primary"]',
  'button[class*="okta"]',
  'input[value*="Next" i]',
  'input[value*="Continue" i]',
];

const PASSWORD_SELECTORS = ['input[type="password"]'];

const LOGIN_SUBMIT_SELECTORS = [
  'button[type="submit"]',
  'input[type="submit"]',
  '#login',
  'button.btn-primary',
  'xpath=//button[contains(text(), "Login") or contains(text(), "Sign In") or contains(text(), "Log in")]',
];

const DASHBOARD_SELECTORS_MAIN = [
  'a[href*="reports"]',
  'a[href*="Reports"]',
  '.dashboard',
  '.nav',
  '[class*="dashboard"]',
  '[id*="dashboard"]',
  'a[href*="performance"]',
  '[class*="menu"]',
  '[id*="menu"]',
];

const DASHBOARD_SELECTORS_VERIFY = [
  ...DASHBOARD_SELECTORS_MAIN,
  '[class*="reports"]',
  '[id*="reports"]',
];

const ERROR_MESSAGE_SELECTORS = [
  '.error',
  '.alert',
  '.alert-danger',
  '.alert-error',
  '[class*="error"]',
  '[class*="alert"]',
  '[role="alert"]',
  '[id*="error"]',
  '[id*="alert"]',
  '.message-error',
  '.notification-error',
];

const REPORT_IFRAME_SELECTORS = [
  'iframe#reportFrame',
  'iframe#iframeReport',
  'iframe[src*="reports_js.cj"]',
  'iframe[src*="reports_js"]',
  'iframe[src*="member"][src*="report"]',
  'iframe[src*="report"]',
  'iframe[src*="performance"]',
  'iframe[src*="cj.com"]',
  'iframe[id*="report"]',
  'iframe[name*="report"]',
  'iframe.o_iframe',
  'iframe[id*="o_iframe"]',
];

const TARGET_LOCATORS = {
  /** Γραμμή #19 — performance context (όχι Select2 container) */
  performance: [
    '#performanceReportRunButton',
    '#performanceReportNameSelect',
    '#performanceDownloadButton',
    'button#performanceReportRunButton',
    'button[data-tooltip-key*="download"]',
    'select#performanceReportNameSelect',
    'select#performanceReportTrendPeriodSelect',
    'select#performanceReportDateDaySelect',
    'xpath=//button[contains(@id,"performance") and contains(@id,"Run")]',
    'xpath=//select[contains(@id,"performanceReport")]',
  ],
};

const REPORTS_DROPDOWN_SELECTORS = [
  '#adv-insights',
  'button[id="adv-insights"]',
  'xpath=//button[contains(text(), "Reports")]',
  "[data-testid='Reports-dropdown-container'] button",
  'xpath=//header//button[contains(., "Reports")]',
  'nav a[href*="reports_js"]',
  'nav a[href*="tab=performance"]',
];

const PERFORMANCE_LINK_CANDIDATES = [
  'a[href*="#?tab=performance"]',
  'a[href*="tab=performance"]',
  'a[href*="reports_js.cj"][href*="performance"]',
];

const PERFORMANCE_LINK_SELECTORS = [
  '#adv-reports-performance',
  "a[id='adv-reports-performance']",
  'xpath=//a[contains(@href, "performance") and contains(text(), "Performance")]',
  'xpath=//a[contains(@href, "tab=performance")]',
  ...PERFORMANCE_LINK_CANDIDATES,
];

/** Γραμμή #15 */
const PERF_INITIAL_WAIT_SELECTORS = [
  '#performanceReportRunButton',
  '#performanceReportNameSelect',
  "xpath=//button[contains(@id,'ReportRunButton')]",
];

/** Γραμμή #26 — DOWNLOAD Performance δοκιμή 1 (και fallback id που δείχνεις από CJ UI) */
const PERF_DOWNLOAD_TRY_1 = [
  '#performanceDownloadButton',
  '#performanceReportDownloadButton',
  '#performanceReportExportButton',
];

/** Γραμμή #27 — δοκιμή 2 */
const PERF_DOWNLOAD_TRY_2 = [
  'button#performanceReportExportButton',
  'button#performanceReportDownloadButton',
  'button#performanceDownloadButton',
  // Keep generic download button only as very last performance fallback.
  'button.downloadButton',
  'button[data-tooltip-key*="download"]',
  'button[id*="Download"]',
];

/** Γραμμή #28 — δοκιμή 3 */
const PERF_DOWNLOAD_TRY_3 = [
  // Scope XPath to performance ids/text to avoid transaction export controls.
  'xpath=//button[contains(@id,"performance") and contains(translate(., "ABCDEFGHIJKLMNOPQRSTUVWXYZ", "abcdefghijklmnopqrstuvwxyz"), "download")]',
  'xpath=//a[contains(@id,"performance") and contains(translate(., "ABCDEFGHIJKLMNOPQRSTUVWXYZ", "abcdefghijklmnopqrstuvwxyz"), "download")]',
  // Python parity fallback: CJ συχνά έχει generic icon/button χωρίς performance id.
  'xpath=//i[contains(@class,"download")]/ancestor::button[1]',
  'i.i-cj-download-alt',
  'xpath=//button[contains(translate(., "ABCDEFGHIJKLMNOPQRSTUVWXYZ", "abcdefghijklmnopqrstuvwxyz"), "download")]',
];

const PERF_DOWNLOAD_SELECTORS = [...PERF_DOWNLOAD_TRY_1, ...PERF_DOWNLOAD_TRY_2, ...PERF_DOWNLOAD_TRY_3];

/** Γραμμή #25 / #39 — μετά το RUN */
const POST_RUN_DOWNLOAD_UI_WAIT = ['i.i-cj-download-alt', 'button.downloadButton'];

/** Μετά το Run το CJ χρειάζεται αρκετά δευτερόλεπτα για να γεμίσει το grid· αν πατήσεις Download νωρίς, το CSV βγαίνει σχεδόν μόνο κεφαλίδα / λάθος parse. */
async function waitAfterRunBeforePerformanceDownload(root, page) {
  log('Waiting before CSV download (report generation — avoid empty/header-only file)');
  await page.waitForTimeout(18000);
  for (let i = 0; i < 35; i++) {
    try {
      const loc = root
        .locator(
          '#performanceReportDownloadButton, #performanceDownloadButton, #performanceReportExportButton, button.downloadButton'
        )
        .first();
      if (await loc.count()) {
        const dis = await loc.getAttribute('disabled');
        const ad = await loc.getAttribute('aria-disabled');
        if (dis == null && ad !== 'true') {
          await page.waitForTimeout(2500);
          return;
        }
      }
    } catch (_) {}
    await page.waitForTimeout(2000);
  }
  log('Download control still looks disabled after wait; attempting download anyway');
  log('Post-run wait finished — starting download');
}

/**
 * Το CJ συχνά επιστρέφει csvx μόνο με κεφαλίδα + "","" αν κατεβάσεις πριν γεμίσει το grid.
 * Περιμένουμε τουλάχιστον μία γραμμή με ημερομηνία (YYYY-MM-DD ή US format) μέσα στο iframe.
 */
async function waitForPerformanceGridHasData(root, page, timeoutMs = 90000) {
  const started = Date.now();
  log('Waiting until performance grid shows date rows (avoids header-only csvx)');
  // CJ UI often shows localized period cells, e.g. 15-Apr-2026, not ISO dates.
  const dateRe =
    /\b20\d{2}-\d{2}-\d{2}\b|\b\d{1,2}\/\d{1,2}\/\d{2,4}\b|\b\d{1,2}-(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)-20\d{2}\b/i;
  while (Date.now() - started < timeoutMs) {
    try {
      const tr = root.locator('tbody tr, table tr, [role="row"]');
      const n = await tr.count();
      if (n >= 2) {
        const maxCheck = Math.min(n, 25);
        for (let i = 0; i < maxCheck; i++) {
          const t = await tr.nth(i).innerText().catch(() => '');
          if (dateRe.test(t)) {
            log(`Performance grid ready (${n} row(s) in DOM, date text found); pause before download`);
            await page.waitForTimeout(4000);
            return true;
          }
        }
      }
    } catch (_) {}
    await page.waitForTimeout(2000);
  }
  log('Timeout waiting for performance grid dates — download may still be header-only');
  return false;
}

function _sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

/** Αφαίρεση διπλότυπων query keys (το CJ βάζει 2× columns= / fileName= — μερικές φορές χαλάει το stream). */
function normalizeCjExportUrl(u) {
  try {
    const parsed = new URL(String(u || ''));
    const sp = new URLSearchParams(parsed.search);
    const deduped = new URLSearchParams();
    for (const [k, v] of sp.entries()) {
      if (!deduped.has(k)) deduped.set(k, v);
    }
    parsed.search = deduped.toString();
    return parsed.toString();
  } catch (_) {
    return String(u || '');
  }
}

/** Το body που πήραμε μοιάζει με «άδειο» csvx (πολλές κενές ζεύξεις, ελάχιστες ημερομηνίες); */
function csvxBodyLooksHeaderOnlyOrEmpty(buf) {
  if (!buf || buf.length < 400) return false;
  const raw = Buffer.isBuffer(buf) ? buf.toString('utf8') : String(buf);
  if (!/report\.column\.period/i.test(raw)) return false;
  const dates =
    (raw.match(/\b20\d{2}-\d{2}-\d{2}\b/g) || []).length +
    (raw.match(/\b\d{1,2}\/\d{1,2}\/\d{4}\b/g) || []).length;
  if (dates >= 4) return false;
  const lines = raw.split(/\r?\n/).filter((x) => String(x || '').trim().length > 0);
  if (lines.length < 6) return false;
  let shortEmptyish = 0;
  for (let i = 1; i < lines.length; i++) {
    const s = String(lines[i] || '').trim();
    if (s.length <= 10 && /[",]/.test(s)) shortEmptyish++;
  }
  return shortEmptyish > Math.max(30, Math.floor(lines.length * 0.65));
}

/** Επαναλήψεις GET + εναλλακτικό .csv — το stream μερικές φορές γεμίζει αφού ολοκληρωθεί το report server-side. */
async function fetchCjPerformanceStreamWithRetry(context, url, logFn) {
  const base = normalizeCjExportUrl(url);
  const variants = [base];
  if (/\.csvx(\?|$)/i.test(base)) variants.push(base.replace(/\.csvx(\?|$)/i, '.csv$1'));
  let best = null;
  const firstVariant = variants[0];
  for (const u0 of variants) {
    for (let attempt = 0; attempt < 14; attempt++) {
      try {
        const r = await context.request.get(u0, { timeout: 55000 });
        if (!r || !r.ok()) {
          await _sleep(attempt === 0 ? 2000 : 4500);
          continue;
        }
        const body = await r.body();
        if (body?.length) {
          if (!best || body.length > best.length) best = body;
          if (!csvxBodyLooksHeaderOnlyOrEmpty(body)) {
            if (attempt > 0 || u0 !== firstVariant) {
              logFn(
                `export stream OK (${/\.csv(\?|$)/i.test(u0) ? 'csv' : 'csvx'}, attempt ${attempt + 1})`
              );
            }
            return body;
          }
        }
      } catch (_) {}
      await _sleep(4500);
    }
  }
  return best;
}

const RUN_REPORT_SELECTORS = [
  "xpath=//button[contains(@id,'ReportRunButton') or contains(@class,'runReportButton')]",
  'xpath=//button[contains(translate(., "ABCDEFGHIJKLMNOPQRSTUVWXYZ", "abcdefghijklmnopqrstuvwxyz"), "run report")]',
];

const MODAL_DOWNLOAD = 'xpath=//div[contains(@class,"ui-dialog-buttonset")]//button[contains(., "Download") or contains(., "download")]';

function log(msg) {
  const ts = new Date().toISOString();
  console.log(`[CJ-scraper ${ts}] ${msg}`);
}

async function safeGoto(page, url, timeoutMs = 60000) {
  try {
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: timeoutMs });
    await page.waitForTimeout(2000);
    return true;
  } catch (e) {
    log(`goto failed (${url}): ${e.message}`);
    return false;
  }
}

async function waitForPageReady(page, timeoutMs = 20000) {
  try {
    await page.waitForFunction(() => document.readyState === 'complete', { timeout: timeoutMs });
  } catch (_) {}
}

async function firstVisibleLocator(root, selectors) {
  for (const s of selectors) {
    try {
      const loc = root.locator(s).first();
      if (await loc.count()) {
        const visible = await loc.isVisible().catch(() => false);
        if (visible) return loc;
      }
    } catch (_) {}
  }
  return null;
}

/** By.LINK_TEXT / PARTIAL_LINK_TEXT / string selectors — Python σειρά 1.1 */
async function findLoginLinkOnPage(page) {
  const roleExact = page.getByRole('link', { name: 'Login', exact: true }).first();
  try {
    if (await roleExact.count()) {
      const v = await roleExact.isVisible().catch(() => false);
      if (v) return roleExact;
    }
  } catch (_) {}
  const rolePartial = page.getByRole('link', { name: /Login/i }).first();
  try {
    if (await rolePartial.count()) {
      const v = await rolePartial.isVisible().catch(() => false);
      if (v) return rolePartial;
    }
  } catch (_) {}
  return firstVisibleLocator(page, LOGIN_LINK_STRING_SELECTORS);
}

async function jsScrollIntoViewAndClick(locator) {
  await locator
    .evaluate((el) => {
      el.scrollIntoView({ block: 'center', inline: 'nearest' });
      const ev = new MouseEvent('click', { bubbles: true, cancelable: true, view: window });
      el.dispatchEvent(ev);
      if (typeof el.click === 'function') el.click();
    })
    .catch(async () => {
      await locator.click().catch(() => {});
    });
}

/** _find_login_button: default_content + ίδια λίστα σε κάθε frame */
async function findLoginSubmitButton(page) {
  const tryRoot = async (root) => firstVisibleLocator(root, LOGIN_SUBMIT_SELECTORS);
  let btn = await tryRoot(page);
  if (btn) return btn;
  for (const f of page.frames()) {
    if (f === page.mainFrame()) continue;
    btn = await tryRoot(f);
    if (btn) return btn;
  }
  return null;
}

async function anyLocatorCountPositive(root, selectors) {
  for (const s of selectors) {
    try {
      const n = await root.locator(s).count();
      if (n > 0) return true;
    } catch (_) {}
  }
  return false;
}

async function findPasswordInFrames(page) {
  let loc = await firstVisibleLocator(page, PASSWORD_SELECTORS);
  if (loc) return loc;
  for (const f of page.frames()) {
    if (f === page.mainFrame()) continue;
    loc = await firstVisibleLocator(f, PASSWORD_SELECTORS);
    if (loc) return loc;
  }
  return null;
}

function findColumn(normalizedMap, candidates) {
  for (const key of candidates) {
    const lookup = normalizeHeaderLookupKey(key);
    if (Object.prototype.hasOwnProperty.call(normalizedMap, lookup)) return normalizedMap[lookup];
  }
  return null;
}

/** BOM / zero-width / NFKC / lowercase — ίδια λογική για keys από CSV και για υποψήφια ονόματα. */
function normalizeHeaderLookupKey(col) {
  try {
    return String(col ?? '')
      .replace(/^\uFEFF/, '')
      .replace(/[\u200B-\u200D\uFEFF\u2060]/g, '')
      .normalize('NFKC')
      .toLowerCase()
      .replace(/\s+/g, ' ')
      .trim();
  } catch (_) {
    return String(col ?? '')
      .replace(/^\uFEFF/, '')
      .toLowerCase()
      .replace(/\s+/g, ' ')
      .trim();
  }
}

/** Διαδρομή: πρώτα απευθείας ταιριάζει raw keys (αντοχή σε map/dup quirks). */
function matchColumnKeyInRow(sampleRow, canonicalNames) {
  if (!sampleRow || typeof sampleRow !== 'object') return null;
  const want = new Set(
    canonicalNames.map((n) => normalizeHeaderLookupKey(n)).filter((x) => x.length > 0)
  );
  for (const rawKey of Object.keys(sampleRow)) {
    const rs = String(rawKey);
    if (rs.includes(',') && rs.length > 45) continue /* collapsed header key */;
    if (want.has(normalizeHeaderLookupKey(rawKey))) return rawKey;
  }
  return null;
}

function matchPublisherNameKey(sampleRow) {
  const direct = matchColumnKeyInRow(sampleRow, [
    'publisherName',
    'publisher name',
    'publisher_name',
    'website name',
    'websiteName',
    'publisher',
  ]);
  if (direct) return direct;
  if (!sampleRow || typeof sampleRow !== 'object') return null;
  for (const rawKey of Object.keys(sampleRow)) {
    const rs = String(rawKey);
    if (rs.includes(',') && rs.length > 45) continue;
    const nk = normalizeHeaderLookupKey(rawKey);
    if (!nk.includes('publisher')) continue;
    if (!nk.includes('name')) continue;
    if (/(commission|amount|fee|rate|id$|company|cid)/i.test(nk)) continue;
    return rawKey;
  }
  return null;
}

/** CJ Insights / Performance CSV: BOM, extra spaces, renamed headers — map με fuzzy fallback (docs.cj.com exports). */
function buildNormalizedHeaderMap(firstRow) {
  const normalized = {};
  for (const col of Object.keys(firstRow)) {
    const k = normalizeHeaderLookupKey(col);
    if (k && !Object.prototype.hasOwnProperty.call(normalized, k)) normalized[k] = col;
  }
  return normalized;
}

/** Ένα κλειδί = ολόκληρη η κεφαλίδα CSV — όχι fuzzy ταιριάσματα πάνω του (βλ. date: «report.column.period,publisherName,…»). */
function isMegaCollapsedHeaderObjectKey(key) {
  const s = String(key ?? '');
  return s.includes(',') && s.length > 45 && /report\.column\./i.test(s) && /publisher/i.test(s);
}

function pickColumnByFuzzy(normalizedMap, includeSubstrings, excludeSubstrings = []) {
  const ex = excludeSubstrings.map((s) => s.toLowerCase());
  for (const nk of Object.keys(normalizedMap)) {
    const rawCol = normalizedMap[nk];
    if (isMegaCollapsedHeaderObjectKey(rawCol)) continue;
    if (ex.some((x) => nk.includes(x))) continue;
    for (const sub of includeSubstrings) {
      if (nk.includes(sub)) return rawCol;
    }
  }
  return null;
}

/** Αν το CJ αλλάζει header (BOM, i18n), βρες το πραγματικό key της πρώτης γραμμής. */
function inferPublisherNameColumnFromRow(firstRow) {
  const m = matchPublisherNameKey(firstRow);
  if (m) return m;
  if (!firstRow || typeof firstRow !== 'object') return null;
  for (const col of Object.keys(firstRow)) {
    const colStr = String(col);
    if (colStr.includes(',') && colStr.length > 40) continue;
    const low = normalizeHeaderLookupKey(colStr);
    if (!low) continue;
    if (
      low === 'publisher' ||
      low === 'publisher name' ||
      low === 'publishername' ||
      low === 'website name' ||
      low === 'websitename' ||
      low === 'pub name'
    ) {
      return col;
    }
    if (low.includes('publisher') && low.includes('name') && !low.includes('id')) return col;
  }
  return null;
}

function parseMoneyCell(v) {
  if (v == null || v === '') return 0;
  let s = String(v).trim();
  let neg = false;
  if (/^\([^)]+\)$/.test(s)) {
    neg = true;
    s = s.slice(1, -1).trim();
  }
  if (/^-/.test(s)) {
    neg = !neg;
    s = s.slice(1).trim();
  }
  s = s.replace(/[$€£¥]/g, '').replace(/\s/g, '');
  s = s.replace(/[^\d.,-]/g, '');
  if (!s || s === '-') return 0;
  const lastComma = s.lastIndexOf(',');
  const lastDot = s.lastIndexOf('.');
  if (lastComma > -1 && lastDot > -1) {
    if (lastComma > lastDot) s = s.replace(/\./g, '').replace(',', '.');
    else s = s.replace(/,/g, '');
  } else if (lastComma > -1 && lastDot === -1) {
    const parts = s.split(',');
    if (parts.length === 2 && parts[1].length <= 2) s = parts[0].replace(/\./g, '') + '.' + parts[1];
    else s = s.replace(/,/g, '');
  } else {
    s = s.replace(/,/g, '');
  }
  const n = parseFloat(s);
  const out = isNaN(n) ? 0 : n;
  return neg ? -Math.abs(out) : out;
}

function parseIntCell(v) {
  if (v == null || v === '') return 0;
  const s = String(v).replace(/,/g, '').replace(/[^\d.-]/g, '').trim();
  if (!s) return 0;
  const n = parseFloat(s);
  return isNaN(n) ? 0 : Math.round(n);
}

/** Χωρισμός γραμμής CSV σε κελιά (κόμμα εκτός εισαγωγικών) — όταν το csv-parse επιστρέφει 1 «στήλη» με όλη την κεφαλίδα. */
function splitCsvLineRespectQuotes(line) {
  const out = [];
  let cur = '';
  let inQuotes = false;
  const s = String(line || '');
  const isQuote = (ch) => ch === '"' || ch === '“' || ch === '”';
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    const next = s[i + 1];
    if (inQuotes) {
      if (isQuote(c) && isQuote(next)) {
        cur += '"';
        i++;
        continue;
      }
      if (isQuote(c)) {
        inQuotes = false;
        continue;
      }
      cur += c;
      continue;
    }
    if (isQuote(c)) {
      inQuotes = true;
      continue;
    }
    if (c === ',') {
      out.push(cur.trim());
      cur = '';
      continue;
    }
    cur += c;
  }
  out.push(cur.trim());
  return out;
}

/** Ίδια λογική με κόμμα — για ευρωπαϊκό CSV με `;` ή TSV. */
function splitDelimitedLineRespectQuotes(line, delim) {
  const out = [];
  let cur = '';
  let inQuotes = false;
  const s = String(line || '');
  const D = delim === '\t' ? '\t' : String(delim || ',').charAt(0);
  const isQuote = (ch) => ch === '"' || ch === '“' || ch === '”';
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    const next = s[i + 1];
    if (inQuotes) {
      if (isQuote(c) && isQuote(next)) {
        cur += '"';
        i++;
        continue;
      }
      if (isQuote(c)) {
        inQuotes = false;
        continue;
      }
      cur += c;
      continue;
    }
    if (isQuote(c)) {
      inQuotes = true;
      continue;
    }
    if (c === D) {
      out.push(cur.trim());
      cur = '';
      continue;
    }
    cur += c;
  }
  out.push(cur.trim());
  return out;
}

/** Ποιο delimiter δίνει περισσότερα (και έγκυρα) κελιά — `;` μόνο αν νικάει σαφώς το `,` (ευρωπαϊκό CSV). */
function guessPerfCsvLineDelimiter(line) {
  const t = String(line || '');
  const nComma = splitCsvLineRespectQuotes(t).length;
  const nSemi = splitDelimitedLineRespectQuotes(t, ';').length;
  const nTab = splitDelimitedLineRespectQuotes(t, '\t').length;
  if (nSemi >= CJ_PERF_CSV_MIN_HEADER_COLS && nSemi > nComma) return ';';
  if (nTab >= CJ_PERF_CSV_MIN_HEADER_COLS && nTab > nComma && nTab >= nSemi) return '\t';
  return ',';
}

/** Σπάει raw CSV σε "λογικές" γραμμές: newline μόνο εκτός εισαγωγικών. */
function splitCsvLogicalLinesRespectQuotes(raw) {
  const lines = [];
  let cur = '';
  let inQuotes = false;
  const s = String(raw || '');
  const isQuote = (ch) => ch === '"' || ch === '“' || ch === '”';
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    const next = s[i + 1];
    if (isQuote(c) && inQuotes && isQuote(next)) {
      cur += '"';
      i++;
      continue;
    }
    if (isQuote(c)) {
      inQuotes = !inQuotes;
      cur += c;
      continue;
    }
    if ((c === '\n' || c === '\r') && !inQuotes) {
      if (cur.trim() !== '') lines.push(cur);
      cur = '';
      if (c === '\r' && next === '\n') i++;
      continue;
    }
    cur += c;
  }
  if (cur.trim() !== '') lines.push(cur);
  return lines;
}

/** CJ Partner Daily export: date + publisher + τουλάχιστον μερικά metrics — όχι αυστηρά 8+ στήλες. */
const CJ_PERF_CSV_MIN_HEADER_COLS = 5;

/**
 * Κεφαλίδα CJ σε ένα κελί/εισαγωγικά: "report.column.period,publisherName,...,clicks,imps"
 * — χωρίζουμε σε κόμμα (τα κλειδιά CJ δεν περιέχουν κόμμα).
 */
function splitCjPerformanceHeaderCells(line) {
  const trimmed = String(line || '').replace(/^\uFEFF/, '').trim();
  let cells = splitCsvLineRespectQuotes(trimmed);
  if (cells.length < CJ_PERF_CSV_MIN_HEADER_COLS) {
    const semi = splitDelimitedLineRespectQuotes(trimmed, ';');
    if (semi.length >= CJ_PERF_CSV_MIN_HEADER_COLS) cells = semi;
  }
  if (cells.length < CJ_PERF_CSV_MIN_HEADER_COLS) {
    const tb = splitDelimitedLineRespectQuotes(trimmed, '\t');
    if (tb.length >= CJ_PERF_CSV_MIN_HEADER_COLS) cells = tb;
  }
  // CJ edge-case: header can arrive as 2-7 quoted fragments due broken wrapping.
  if (cells.length >= 2 && cells.length < 20) {
    const stitched = cells
      .map((c) => String(c || '').replace(/^"|"$/g, '').replace(/[\r\n]+/g, '').trim())
      .filter((c) => c !== '')
      .join(',');
    if (/report\.column\./i.test(stitched) && /publishername|publisher.?name/i.test(stitched)) {
      cells = stitched.split(',').map((s) => s.trim());
    }
  }
  if (cells.length >= CJ_PERF_CSV_MIN_HEADER_COLS) {
    return cells.map((h, i) => {
      const t = String(h || '').trim();
      return t || `__col${i}`;
    });
  }
  if (cells.length !== 1) return cells;
  const blob = cells[0].replace(/^"|"$/g, '').trim();
  if (!blob.includes(',')) return cells;
  if (!(/report\.column\.|publishername|publisher.?name/i.test(blob))) return cells;
  const split = blob.split(',').map((s, i) => {
    const t = s.trim().replace(/^"|"$/g, '');
    return t || `__col${i}`;
  });
  return split.length >= CJ_PERF_CSV_MIN_HEADER_COLS ? split : cells;
}

function splitPerformanceDataLine(line, expectedCols) {
  let cells = [];
  try {
    const r = parse(line, {
      columns: false,
      relax_column_count: true,
      relax_quotes: true,
      trim: true,
      skip_empty_lines: false,
    });
    if (r[0] && Array.isArray(r[0])) {
      cells = r[0].map((c) => (c != null ? String(c).trim() : ''));
    }
  } catch (_) {
    cells = [];
  }
  if (cells.length < Math.min(expectedCols, 5)) {
    cells = splitCsvLineRespectQuotes(line);
  }
  while (cells.length < expectedCols) cells.push('');
  if (cells.length > expectedCols) cells = cells.slice(0, expectedCols);
  return cells;
}

function rowLooksLikeCjDataStart(cells) {
  const a = String(cells[0] ?? '').trim();
  if (/^\d{4}-\d{2}-\d{2}/.test(a)) return true;
  if (/^\d{1,2}\/\d{1,2}\/20\d{2}/.test(a)) return true;
  if (/^\d{1,2}\.\d{1,2}\.20\d{2}/.test(a)) return true;
  return false;
}

/** Πολλαπλά delimiters + csv-parse — κοινό για repair / expand mega-column. */
function splitCjPerfDataLineRobust(line, ncol) {
  const attempts = [];
  const push = (arr) => {
    if (!Array.isArray(arr) || !arr.length) return;
    attempts.push(arr.map((c) => String(c ?? '').trim()));
  };
  push(splitPerformanceDataLine(line, ncol));
  push(splitDelimitedLineRespectQuotes(line, ','));
  push(splitDelimitedLineRespectQuotes(line, ';'));
  push(splitDelimitedLineRespectQuotes(line, '\t'));
  let best = null;
  let bestScore = -1;
  for (const c of attempts) {
    if (c.length < 2) continue;
    const pad = [...c];
    while (pad.length < ncol) pad.push('');
    const slice = pad.slice(0, ncol);
    let score = slice.filter((x) => x !== '').length;
    if (rowLooksLikeCjDataStart(slice)) score += 80;
    if (/^report\.column\./i.test(String(slice[0] || '').trim())) score -= 120;
    if (score > bestScore) {
      bestScore = score;
      best = slice;
    }
  }
  return best || splitPerformanceDataLine(line, ncol);
}

function normalizeCsvRecordCells(rec) {
  return (Array.isArray(rec) ? rec : []).map((c) => String(c ?? '').replace(/\uFEFF/g, '').trim());
}

function cleanCjHeaderToken(t) {
  return String(t ?? '')
    .replace(/^\uFEFF/g, '')
    .replace(/^["'“”]|["'“”]$/g, '')
    .trim();
}

/** Άμεσο split κεφαλίδας CJ (κλειδιά χωρίς κόμμα μέσα). */
function splitCjHeaderCommaList(s) {
  const blob = String(s || '').replace(/[“”]/g, '"').trim();
  if (!blob.includes(',')) return [];
  return blob
    .split(',')
    .map((x) => cleanCjHeaderToken(x))
    .filter((x) => x !== '');
}

function reconstructCjHeaderFromRecord(rec) {
  const cells = normalizeCsvRecordCells(rec).map(cleanCjHeaderToken);
  // Πρώτο πεδίο = ολόκληρη κεφαλίδα ως string, δεύτερο = ISO date — όχι `cells.length>=5` (θα έβαζε την ημερομηνία ως όνομα στήλης)
  if (
    cells.length >= 2 &&
    cells[0].includes(',') &&
    /report\.column\./i.test(cells[0]) &&
    /^\d{4}-\d{2}-\d{2}/.test(cells[1])
  ) {
    let headerOnly = splitCjPerformanceHeaderCells(cells[0]);
    if (!Array.isArray(headerOnly) || headerOnly.length < CJ_PERF_CSV_MIN_HEADER_COLS) {
      headerOnly = splitCjHeaderCommaList(cells[0]);
    }
    if (headerOnly.length >= CJ_PERF_CSV_MIN_HEADER_COLS) {
      return headerOnly.map((h, i) => h || `__col${i}`);
    }
  }
  // Ένα κελί με ολόκληρη την κεφαλίδα (quoted ή όχι)
  if (cells.length === 1 && cells[0].includes(',') && /report\.column\./i.test(cells[0])) {
    const fromSplitFn = splitCjPerformanceHeaderCells(cells[0]);
    if (Array.isArray(fromSplitFn) && fromSplitFn.length >= CJ_PERF_CSV_MIN_HEADER_COLS) {
      return fromSplitFn.map((h, i) => h || `__col${i}`);
    }
    const raw = splitCjHeaderCommaList(cells[0]);
    if (raw.length >= CJ_PERF_CSV_MIN_HEADER_COLS) return raw.map((h, i) => h || `__col${i}`);
  }
  if (cells.length >= CJ_PERF_CSV_MIN_HEADER_COLS) return cells.map((h, i) => h || `__col${i}`);
  const joined = cells.join(',').replace(/[“”]/g, '"');
  if (!/report\.column\./i.test(joined) || !/publishername|publisher.?name/i.test(joined)) return null;
  let rebuilt = splitCjPerformanceHeaderCells(joined);
  if (Array.isArray(rebuilt) && rebuilt.length >= CJ_PERF_CSV_MIN_HEADER_COLS) {
    return rebuilt.map((h, i) => h || `__col${i}`);
  }
  rebuilt = splitCjHeaderCommaList(joined);
  return rebuilt.length >= CJ_PERF_CSV_MIN_HEADER_COLS ? rebuilt.map((h, i) => h || `__col${i}`) : null;
}

/** Index πρώτης γραμμής που μοιάζει με κεφαλίδα CJ Performance (ώστε να αγνοηθεί τίτλος report κ.λπ.). */
function findCjPerformanceHeaderRecordIndex(records) {
  if (!Array.isArray(records)) return -1;
  for (let i = 0; i < records.length; i++) {
    const rec = records[i];
    if (!rec?.length) continue;
    const c = normalizeCsvRecordCells(rec).map(cleanCjHeaderToken);
    const joined = c.join(',');
    if (!/report\.column\./i.test(joined)) continue;
    if (!/publishername|website.?name|publisher.?name/i.test(joined)) continue;
    if (c.length >= CJ_PERF_CSV_MIN_HEADER_COLS) return i;
    if (c.length === 1 && c[0].includes(',')) return i;
    if (c.length >= 2 && c[0].includes(',') && /report\.column\./i.test(c[0])) return i;
  }
  return -1;
}

/**
 * Από csv-parse columns:false — χειρίζεται: (1) ένα flat record χωρίς newlines,
 * (2) πρώτο record [κεφαλίδα-string, ημερομηνία, …], (3) κλασική κεφαλίδα + γραμμές.
 */
function buildCjRowsFromColumnlessRecords(records) {
  if (!Array.isArray(records) || !records.length) return null;

  const headerIdx = findCjPerformanceHeaderRecordIndex(records);
  if (headerIdx >= 0) records = records.slice(headerIdx);

  if (records.length === 1 && records[0].length >= CJ_PERF_CSV_MIN_HEADER_COLS * 2) {
    const flat = records[0].map((c) => cleanCjHeaderToken(String(c ?? '')));
    const idx = flat.findIndex((c) => /^\d{4}-\d{2}-\d{2}/.test(c));
    if (idx >= CJ_PERF_CSV_MIN_HEADER_COLS) {
      const header = flat.slice(0, idx);
      const rest = flat.slice(idx);
      const ncol = header.length;
      if (rest.length >= ncol) {
        const rows = [];
        for (let i = 0; i + ncol <= rest.length; i += ncol) {
          const slice = rest.slice(i, i + ncol);
          const o = {};
          header.forEach((h, j) => {
            const key = h && String(h).trim();
            if (key) o[key] = slice[j] ?? '';
          });
          if (slice.some((x) => x !== '')) rows.push(o);
        }
        if (rows.length) return rows;
      }
    }
  }

  // Ένα μόνο logical record: `"header1,...,headerN",date,...,πόσα κελιά` (χωρίς newline ανάμεσα)
  if (records.length === 1 && records[0].length >= 2) {
    const c0 = records[0].map((c) => cleanCjHeaderToken(String(c ?? '')));
    if (
      c0[0].includes(',') &&
      /report\.column\./i.test(c0[0]) &&
      /^\d{4}-\d{2}-\d{2}/.test(c0[1])
    ) {
      let hOnly = splitCjPerformanceHeaderCells(c0[0]);
      if (!Array.isArray(hOnly) || hOnly.length < CJ_PERF_CSV_MIN_HEADER_COLS) hOnly = splitCjHeaderCommaList(c0[0]);
      if (hOnly.length >= CJ_PERF_CSV_MIN_HEADER_COLS) {
        const header = hOnly.map((h, i) => h || `__col${i}`);
        const ncol = header.length;
        const tail = c0.slice(1);
        const rows = [];
        for (let i = 0; i + ncol <= tail.length; i += ncol) {
          const slice = tail.slice(i, i + ncol);
          const o = {};
          header.forEach((hname, j) => {
            if (hname) o[hname] = slice[j] ?? '';
          });
          if (slice.some((x) => x !== '')) rows.push(o);
        }
        if (rows.length) return rows;
      }
    }
  }

  if (records.length < 2) return null;

  const c0 = normalizeCsvRecordCells(records[0]).map(cleanCjHeaderToken);
  let header = null;
  let tailFromFirst = null;

  if (
    c0.length >= 2 &&
    c0[0].includes(',') &&
    /report\.column\./i.test(c0[0]) &&
    /^\d{4}-\d{2}-\d{2}/.test(c0[1])
  ) {
    let hOnly = splitCjPerformanceHeaderCells(c0[0]);
    if (!Array.isArray(hOnly) || hOnly.length < CJ_PERF_CSV_MIN_HEADER_COLS) hOnly = splitCjHeaderCommaList(c0[0]);
    if (hOnly.length >= CJ_PERF_CSV_MIN_HEADER_COLS) {
      header = hOnly.map((h, i) => h || `__col${i}`);
      tailFromFirst = c0.slice(1);
    }
  }

  if (!header) header = reconstructCjHeaderFromRecord(records[0]);
  if (!header || header.length < CJ_PERF_CSV_MIN_HEADER_COLS) return null;

  const rows = [];
  const pushNormalizedRow = (cellsIn) => {
    let cells = Array.isArray(cellsIn) ? cellsIn.map((x) => cleanCjHeaderToken(String(x ?? ''))) : [];
    if (cells.length < header.length && cells.length > 0) {
      const stitched = cells.join(',');
      const split = splitCsvLineRespectQuotes(stitched);
      if (split.length > cells.length) cells = split.map((x) => String(x ?? '').trim());
    }
    while (cells.length < header.length) cells.push('');
    if (cells.length > header.length) cells = cells.slice(0, header.length);
    if (!cells.some((c) => c !== '')) return;
    const o = {};
    header.forEach((h, j) => {
      if (h) o[h] = cells[j] != null ? cells[j] : '';
    });
    rows.push(o);
  };

  if (tailFromFirst) {
    pushNormalizedRow(tailFromFirst);
    for (let i = 1; i < records.length; i++) {
      pushNormalizedRow(normalizeCsvRecordCells(records[i]));
    }
  } else {
    for (let i = 1; i < records.length; i++) {
      pushNormalizedRow(normalizeCsvRecordCells(records[i]));
    }
  }

  return rows.length ? rows : null;
}

function parseCsvRowsFromRecords(raw) {
  const inputs = String(raw || '')
    .replace(/^\uFEFF/, '')
    .replace(/\0/g, '')
    .replace(/[“”]/g, '"');
  for (const delimiter of [',', ';', '\t']) {
    let records;
    try {
      records = parse(inputs, {
        columns: false,
        delimiter,
        bom: true,
        relax_quotes: true,
        relax_column_count: true,
        skip_empty_lines: true,
        trim: true,
      });
    } catch (_) {
      continue;
    }
    if (!Array.isArray(records) || !records.length) continue;
    const rows = buildCjRowsFromColumnlessRecords(records);
    if (!rows?.length) continue;
    log(`CSV records reparse (delim=${JSON.stringify(delimiter)}, ${Object.keys(rows[0]).length} cols, ${rows.length} rows)`);
    return rows;
  }
  return null;
}

/**
 * Όλο το αρχείο σε μία φυσική γραμμή: πρώτο \\bYYYY-MM-DD\\b = αρχή δεδομένων μετά την κεφαλίδα.
 */
/** Πρώτη εμφάνιση ημερομηνίας δεδομένων (ISO / US / EU) μετά από minIndex. */
function findFirstCjDataDateStart(s, minIndex = 25) {
  const cands = [];
  const add = (idx) => {
    if (typeof idx === 'number' && idx >= minIndex) cands.push(idx);
  };
  const reIso = /\b(20\d{2}-\d{2}-\d{2})\b/g;
  let m;
  while ((m = reIso.exec(s)) !== null) add(m.index);
  const reSlash = /\b(\d{1,2}\/\d{1,2}\/20\d{2})\b/g;
  while ((m = reSlash.exec(s)) !== null) add(m.index);
  const reDot = /\b(\d{1,2}\.\d{1,2}\.20\d{2})\b/g;
  while ((m = reDot.exec(s)) !== null) add(m.index);
  if (!cands.length) return -1;
  return Math.min(...cands);
}

function tryManualSingleLineCjPerf(text) {
  const t = String(text || '')
    .replace(/^\uFEFF/, '')
    .replace(/\0/g, '')
    .replace(/\uFF0C/g, ',')
    .replace(/[“”]/g, '"')
    .trim();
  if (t.length < 80) return null;
  const low = t.toLowerCase();
  if (!low.includes('report.column') || !low.includes('publisher')) return null;
  const dataStart = findFirstCjDataDateStart(t, 28);
  if (dataStart < 0) return null;
  let headerStr = t.slice(0, dataStart).replace(/[,;]\s*$/, '').trim();
  if (headerStr.startsWith('"') && headerStr.endsWith('"')) {
    headerStr = headerStr.slice(1, -1).trim();
  } else if (headerStr.startsWith('"')) {
    headerStr = headerStr.replace(/^"/, '').trim();
  }
  let header = splitCjPerformanceHeaderCells(headerStr).map((h) => cleanCjHeaderToken(String(h || '')));
  if (header.length < CJ_PERF_CSV_MIN_HEADER_COLS) {
    const d0 = guessPerfCsvLineDelimiter(headerStr);
    const rawH =
      d0 === ';'
        ? splitDelimitedLineRespectQuotes(headerStr, ';')
        : d0 === '\t'
          ? splitDelimitedLineRespectQuotes(headerStr, '\t')
          : splitCjHeaderCommaList(headerStr);
    if (rawH.length >= CJ_PERF_CSV_MIN_HEADER_COLS) header = rawH.map((h) => cleanCjHeaderToken(String(h || '')));
  }
  if (!header.length || header.length < CJ_PERF_CSV_MIN_HEADER_COLS) return null;
  header = header.map((h, i) => cleanCjHeaderToken(String(h || `__col${i}`)));
  const ncol = header.length;
  const tail = t.slice(dataStart);
  const delim = guessPerfCsvLineDelimiter(t.slice(0, Math.min(t.length, dataStart + 120)));
  let records;
  try {
    records = parse(tail, {
      columns: false,
      delimiter: delim,
      relax_quotes: true,
      relax_column_count: true,
      trim: true,
      skip_empty_lines: true,
    });
  } catch (_) {
    return null;
  }
  if (!Array.isArray(records) || !records.length) return null;
  const flat = [];
  for (const rec of records) {
    if (!Array.isArray(rec)) continue;
    for (const c of rec) flat.push(cleanCjHeaderToken(String(c ?? '')));
  }
  if (flat.length < ncol) return null;
  const body = [];
  for (let i = 0; i + ncol <= flat.length; i += ncol) {
    const slice = flat.slice(i, i + ncol);
    if (!slice.some((x) => x !== '')) continue;
    const o = {};
    header.forEach((h, j) => {
      const k = h && String(h).trim();
      if (k) o[k] = slice[j] ?? '';
    });
    body.push(o);
  }
  if (body.length) {
    log(`CSV parsePerformanceCsv: manual single-line (${ncol} cols, ${body.length} rows)`);
  }
  return body.length ? body : null;
}

/**
 * Χωρίς csv-parse: σάρωση γραμμών για κεφαλίδα CJ (μετά από preamble). Όταν το csv-parse χαλάει records, αυτό σώζει το import.
 */
function parsePerformanceCsvManualLines(raw) {
  const text = String(raw || '')
    .replace(/^\uFEFF/, '')
    .replace(/\0/g, '')
    .replace(/\uFF0C/g, ',')
    .replace(/[“”]/g, '"')
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
    .replace(/\u2028/g, '\n')
    .replace(/\u2029/g, '\n')
    .trim();
  if (!text) return null;
  const lines = splitCsvLogicalLinesRespectQuotes(text);
  if (lines.length < 2) {
    return tryManualSingleLineCjPerf(text);
  }
  for (let hline = 0; hline < lines.length; hline++) {
    const line = lines[hline];
    if (!line || line.length < 30) continue;
    const low = line.toLowerCase();
    if (!low.includes('report.column') || !low.includes('publisher')) continue;
    let header = splitCjPerformanceHeaderCells(line).map((h) => cleanCjHeaderToken(String(h || '')));
    if (header.length < CJ_PERF_CSV_MIN_HEADER_COLS) {
      const alt = splitCjHeaderCommaList(line);
      if (alt.length >= CJ_PERF_CSV_MIN_HEADER_COLS) header = alt.map((h) => cleanCjHeaderToken(String(h || '')));
    }
    if (header.length < CJ_PERF_CSV_MIN_HEADER_COLS) continue;
    const lineDelim = guessPerfCsvLineDelimiter(line);
    const body = [];
    for (let i = hline + 1; i < lines.length; i++) {
      let cells;
      if (lineDelim === ';') {
        cells = splitDelimitedLineRespectQuotes(lines[i], ';');
      } else if (lineDelim === '\t') {
        cells = splitDelimitedLineRespectQuotes(lines[i], '\t');
      } else {
        cells = splitPerformanceDataLine(lines[i], header.length);
      }
      while (cells.length < header.length) cells.push('');
      if (cells.length > header.length) cells = cells.slice(0, header.length);
      if (!cells.some((c) => c !== '')) continue;
      const o = {};
      header.forEach((h, j) => {
        const k = h && String(h).trim();
        if (k) o[k] = cells[j] ?? '';
      });
      body.push(o);
    }
    if (body.length) {
      log(`CSV parsePerformanceCsv: manual lines (${header.length} cols, ${body.length} rows, headerLine=${hline})`);
      return body;
    }
  }
  return tryManualSingleLineCjPerf(text);
}

/**
 * CJ μερικές φορές γράφει το αρχείο έτσι ώστε το sync parse να δει μία μόνο στήλη
 * (log: date:report.column.period,publisherName,... pubId:—).
 */
function reparseCommaTableFromRaw(raw) {
  const text = String(raw || '')
    .replace(/^\uFEFF/, '')
    .replace(/\0/g, '')
    .replace(/\uFF0C/g, ',')
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
    .trim();
  if (!text) return null;
  for (const delimiter of [',', ';', '\t']) {
    let records;
    try {
      records = parse(text, {
        columns: false,
        delimiter,
        bom: true,
        relax_quotes: true,
        relax_column_count: true,
        skip_empty_lines: true,
        trim: true,
      });
    } catch (_) {
      continue;
    }
    const fromRecords = buildCjRowsFromColumnlessRecords(records);
    if (fromRecords?.length) return fromRecords;
  }
  const lines = splitCsvLogicalLinesRespectQuotes(text);
  if (lines.length < 2) return null;
  const header = splitCjPerformanceHeaderCells(lines[0]).map((h) => h.replace(/^\uFEFF/, '').trim());
  if (header.length < CJ_PERF_CSV_MIN_HEADER_COLS) return null;
  const lineDelim = guessPerfCsvLineDelimiter(lines[0]);
  const body = [];
  for (let i = 1; i < lines.length; i++) {
    let cells;
    if (lineDelim === ';') {
      cells = splitDelimitedLineRespectQuotes(lines[i], ';');
    } else if (lineDelim === '\t') {
      cells = splitDelimitedLineRespectQuotes(lines[i], '\t');
    } else {
      cells = splitPerformanceDataLine(lines[i], header.length);
    }
    while (cells.length < header.length) cells.push('');
    if (cells.length > header.length) cells = cells.slice(0, header.length);
    if (!cells.some((c) => c !== '')) continue;
    const o = {};
    header.forEach((h, j) => {
      const key = h && String(h).trim();
      if (key) o[key] = cells[j] != null ? cells[j] : '';
    });
    body.push(o);
  }
  return body.length ? body : null;
}

function isCollapsedCjPerformanceHeaderRow(row) {
  if (!row || typeof row !== 'object') return false;
  const keys = Object.keys(row);
  if (keys.length !== 1) return false;
  const k = keys[0];
  const hasCjTokens =
    /\breport\.column\./i.test(k) ||
    /publishername/i.test(k) ||
    /publisher.?name/i.test(k);
  if (!hasCjTokens || k.length < 25) return false;
  // Κανονικά το κλειδί περιέχει κόμματα (ολόκληρη η γραμμή header ως όνομα στήλης).
  if (k.includes(',')) return true;
  // Μετά από strip NUL / ελαττωμένο encoding, τα κόμματα μπορεί να χαθούν· μείνε επιθετικός.
  return k.length > 55 && /click|imps|saleamount|commission/i.test(k);
}

/** Ένα μόνο key που περιέχει tokens ολόκληρης κεφαλίδας CJ (csv-parse error) — χωρίς απαραίτητα `,` στο όνομα. */
function looksLikeSingleCjHeaderKeyRow(row) {
  if (!row || typeof row !== 'object') return false;
  const keys = Object.keys(row);
  if (keys.length !== 1) return false;
  const k = keys[0];
  return (
    k.length > 40 &&
    /report\.column\./i.test(k) &&
    /publishername|publisher.?name/i.test(k) &&
    /\bclicks\b|\bimps\b/i.test(k)
  );
}

/**
 * columns:true με 1 στήλη: το όνομα στήλης είναι ολόκληρη η κεφαλίδα CJ και κάθε γραμμή έχει όλα τα δεδομένα στο ίδιο πεδίο.
 */
function expandCollapsedMegaColumnRows(rows) {
  if (!rows?.length || !rows[0]) return null;
  const keys = Object.keys(rows[0]);
  if (keys.length !== 1) return null;
  const mega = keys[0];
  if (!mega.includes(',') || !/report\.column\./i.test(mega) || !/publisher/i.test(mega)) return null;

  let header = splitCjPerformanceHeaderCells(mega);
  if (!Array.isArray(header) || header.length < CJ_PERF_CSV_MIN_HEADER_COLS) {
    header = splitCjHeaderCommaList(mega);
  }
  if (!Array.isArray(header) || header.length < CJ_PERF_CSV_MIN_HEADER_COLS) return null;

  const ncol = header.length;
  const out = [];
  for (const row of rows) {
    const rawVal = row[mega];
    const s = rawVal != null ? String(rawVal).trim() : '';
    if (!s) continue;
    if (/^report\.column\./i.test(s) && /publisher/i.test(s) && s.length > 50) continue;
    let cells = splitPerformanceDataLine(s, ncol);
    if (!rowLooksLikeCjDataStart(cells) && cells.filter((x) => x !== '').length < Math.min(4, ncol)) {
      cells = splitCjPerfDataLineRobust(s, ncol);
    }
    const nonEmpty = cells.filter((x) => x !== '').length;
    if (nonEmpty < 2 && ncol >= 5) {
      try {
        const rec = parse(s, {
          columns: false,
          relax_quotes: true,
          relax_column_count: true,
          trim: true,
        });
        const first = rec[0];
        if (Array.isArray(first) && first.length >= CJ_PERF_CSV_MIN_HEADER_COLS) {
          cells = first.map((c) => String(c ?? '').trim());
          while (cells.length < ncol) cells.push('');
          if (cells.length > ncol) cells = cells.slice(0, ncol);
        }
      } catch (_) {}
    }
    if (!cells.some((c) => c !== '')) continue;
    const o = {};
    header.forEach((h, j) => {
      const key = h && String(h).trim();
      if (key) o[key] = cells[j] != null ? cells[j] : '';
    });
    out.push(o);
  }
  return out.length ? out : null;
}

/**
 * Κανονικό comma-separated CJ Performance export — πριν το csv-parse, που με tab/delimiter κάνει 1 «στήλη».
 */
function tryCjCommaTableFastPath(raw) {
  const firstLine = splitCsvLogicalLinesRespectQuotes(String(raw || ''))[0];
  if (!firstLine) return null;
  const cells = splitCjPerformanceHeaderCells(firstLine.trim());
  if (cells.length < CJ_PERF_CSV_MIN_HEADER_COLS) return null;
  const low = firstLine.toLowerCase();
  const hasPublisher = /publishername|publisher name|website name/i.test(low);
  const hasPeriod = /report\.column\.(period|day)|\bperiod\b/i.test(low);
  const hasMetrics = /\bclicks\b|\bimps\b|\bsales\b|\bleads\b|saleamount|commission/i.test(low);
  if (!(hasPublisher && hasPeriod && hasMetrics)) return null;
  const rebuilt = reparseCommaTableFromRaw(raw);
  if (rebuilt?.[0] && Object.keys(rebuilt[0]).length >= CJ_PERF_CSV_MIN_HEADER_COLS) {
    log(`CSV CJ comma fast path (${Object.keys(rebuilt[0]).length} cols, ${rebuilt.length} rows)`);
    return rebuilt;
  }
  return null;
}

/** Διάβασμα CJ CSV: UTF-8, UTF-16 LE/BE BOM, ή UTF-16 που λάθος φορτώθηκε ως UTF-8 (NUL ανά byte). */
function readPerformanceCsvFileSync(filePath) {
  const buf = fs.readFileSync(filePath);
  if (!buf.length) return '';
  if (buf.length >= 2 && buf[0] === 0xff && buf[1] === 0xfe) {
    return buf.subarray(2).toString('utf16le');
  }
  if (buf.length >= 2 && buf[0] === 0xfe && buf[1] === 0xff) {
    const b = buf.subarray(2);
    const out = Buffer.allocUnsafe(b.length);
    for (let i = 0; i + 1 < b.length; i += 2) {
      out[i] = b[i + 1];
      out[i + 1] = b[i];
    }
    return out.toString('utf16le');
  }
  let s = buf.toString('utf8');
  const nul = s.match(/\0/g);
  if (nul && nul.length > Math.min(80, s.length * 0.08)) {
    const stripped = s.replace(/\0/g, '');
    if (stripped.includes('report.column') || /publishername/i.test(stripped)) return stripped;
  }
  return s.replace(/\0/g, '');
}

/** CJ CSV: μερικές φορές το delimiter διαφεύγει ή το header είναι i18n key (report.column.period). */
function parseCsvRowsAuto(raw) {
  raw = String(raw || '')
    .replace(/^\uFEFF/, '')
    .replace(/\0/g, '')
    .replace(/[“”]/g, '"')
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
    .replace(/\u2028/g, '\n')
    .replace(/\u2029/g, '\n');

  const fast = tryCjCommaTableFastPath(raw);
  if (fast) return fast;
  const recordsFirst = parseCsvRowsFromRecords(raw);
  if (recordsFirst) return recordsFirst;

  const attempts = [
    { delimiter: ',', opts: {} },
    { delimiter: ';', opts: {} },
    { delimiter: '\t', opts: {} },
  ];
  let best = { rows: [], score: 0, delim: ',' };
  for (const { delimiter, opts } of attempts) {
    try {
      const rows = parse(raw, {
        columns: true,
        skip_empty_lines: true,
        trim: true,
        relax_column_count: true,
        bom: true,
        delimiter,
        ...opts,
      });
      const n = rows.length && rows[0] ? Object.keys(rows[0]).length : 0;
      if (n > best.score) best = { rows, score: n, delim: delimiter };
    } catch (_) {}
  }

  const tryManual = () => {
    const rec = parseCsvRowsFromRecords(raw);
    if (rec && rec[0] && Object.keys(rec[0]).length >= 5) return rec;
    const rebuilt = reparseCommaTableFromRaw(raw);
    if (rebuilt && rebuilt[0] && Object.keys(rebuilt[0]).length >= 5) {
      log(`CSV manual comma split (${Object.keys(rebuilt[0]).length} cols, ${rebuilt.length} rows)`);
      return rebuilt;
    }
    const linesArr = splitCsvLogicalLinesRespectQuotes(raw);
    const lineCount = linesArr.length;
    if (lineCount < 2) {
      log(
        `CSV manual reparse: μόνο ${lineCount} μη-κενή γραμμή (χρειάζεται κεφαλίδα + τουλάχιστον 1 γραμμή δεδομένων).`
      );
    } else {
      const hc = splitCjPerformanceHeaderCells(linesArr[0]).length;
      if (hc < CJ_PERF_CSV_MIN_HEADER_COLS) {
        log(
          `CSV manual reparse: κεφαλίδα έσπασε σε ${hc} κελιά (<${CJ_PERF_CSV_MIN_HEADER_COLS}) — πρώτα 120 χαρακτήρες: ${linesArr[0].slice(0, 120)}`
        );
      }
    }
    return null;
  };

  const collapsed =
    best.rows?.length &&
    (isCollapsedCjPerformanceHeaderRow(best.rows[0]) || looksLikeSingleCjHeaderKeyRow(best.rows[0]));

  if (collapsed) {
    const m = tryManual();
    if (m) return m;
  }

  if (best.score >= 3 && !collapsed) return best.rows;

  const manualEarly = tryManual();
  if (manualEarly) return manualEarly;

  if (best.score >= 3) return best.rows;

  // Μία γραμμή = ένα τεράστιο header key (λαθος parse) — ξαναδιάβασε χωρίς columns.
  try {
    const records = parse(raw, { columns: false, skip_empty_lines: true, trim: true, relax_column_count: true, bom: true });
    if (records.length >= 2 && Array.isArray(records[0])) {
      const header = records[0].map((h) => String(h || '').replace(/^\uFEFF/, '').trim());
      const body = records.slice(1).filter((r) => Array.isArray(r) && r.some((c) => String(c || '').trim() !== ''));
      const rows = body.map((r) => {
        const o = {};
        header.forEach((h, i) => {
          if (h) o[h] = r[i] != null ? r[i] : '';
        });
        return o;
      });
      if (rows.length && Object.keys(rows[0]).length >= 3) {
        log(`CSV reparsed from array rows (${header.length} cols)`);
        return rows;
      }
    }
  } catch (_) {}

  // Fallback: re-read raw line-by-line (αν το columns:true έκανε λάθος delimiter).
  try {
    const text = raw.replace(/^\uFEFF/, '').trim();
    const lines = text.split(/\r?\n/).filter((l) => l.trim());
    if (lines.length >= 2) {
      const headerRow = parse(lines[0], { columns: false, relax_column_count: true, trim: true, bom: true });
      const header = headerRow[0] ? headerRow[0].map((h) => String(h || '').trim()) : [];
      if (header.length >= 5) {
        const rebuilt = [];
        for (let i = 1; i < lines.length; i++) {
          const rec = parse(lines[i], { columns: false, relax_column_count: true, trim: true });
          const cells = rec[0];
          if (!cells || !cells.length) continue;
          const o = {};
          header.forEach((h, j) => {
            if (h) o[h] = cells[j] != null ? cells[j] : '';
          });
          rebuilt.push(o);
        }
        if (rebuilt.length) {
          log(`CSV line-by-line reparse (${header.length} cols, ${rebuilt.length} rows)`);
          return rebuilt;
        }
      }
    }
  } catch (_) {}

  return best.rows || [];
}

/** Προτεραιότητα: columns:false + build — το columns:true με quoted κεφαλίδα χάνει όλα τα κελιά εκτός του πρώτου ανά γραμμή. */
function parsePerformanceCsvFromColumnlessRaw(raw) {
  const inputs = String(raw || '')
    .replace(/^\uFEFF/, '')
    .replace(/\0/g, '')
    .replace(/\uFF0C/g, ',')
    .replace(/[“”]/g, '"');
  for (const delimiter of [',', ';', '\t']) {
    let records;
    try {
      records = parse(inputs, {
        columns: false,
        delimiter,
        bom: true,
        relax_quotes: true,
        relax_column_count: true,
        skip_empty_lines: true,
        trim: true,
      });
    } catch (_) {
      continue;
    }
    const rows = buildCjRowsFromColumnlessRecords(records);
    if (rows?.length && Object.keys(rows[0]).length >= CJ_PERF_CSV_MIN_HEADER_COLS) {
      log(
        `CSV parsePerformanceCsv: columnless first (${Object.keys(rows[0]).length} cols, ${rows.length} rows, delim=${JSON.stringify(delimiter)})`
      );
      return rows;
    }
  }
  return null;
}

/**
 * Fallback: απλό split γραμμών (χωρίς quote-aware logical lines) — όταν το CJ CSV είναι κανονικό comma+newline
 * αλλά το csv-parse / splitCsvLogicalLinesRespectQuotes το χαλάει.
 */
function repairCjPerformanceCsvPlainNewlines(raw) {
  const text = String(raw || '')
    .replace(/^\uFEFF/, '')
    .replace(/\0/g, '')
    .replace(/\uFF0C/g, ',')
    .replace(/[“”]/g, '"')
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
    .trim();
  if (!text) return null;
  const lines = text
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l.length > 0);
  if (lines.length < 2) return null;
  const headLine = lines[0];
  const low = headLine.toLowerCase();
  if (!low.includes('report.column') || !low.includes('publisher')) return null;
  let header = splitCjPerformanceHeaderCells(headLine).map((h) => cleanCjHeaderToken(String(h || '')));
  if (header.length < CJ_PERF_CSV_MIN_HEADER_COLS) {
    header = splitCjHeaderCommaList(headLine).map((h) => cleanCjHeaderToken(String(h || '')));
  }
  if (header.length < CJ_PERF_CSV_MIN_HEADER_COLS) return null;
  const ncol = header.length;
  const body = [];
  for (let i = 1; i < lines.length; i++) {
    let cells = splitPerformanceDataLine(lines[i], ncol);
    if (!rowLooksLikeCjDataStart(cells) && cells.filter((x) => x !== '').length < Math.min(4, ncol)) {
      cells = splitCjPerfDataLineRobust(lines[i], ncol);
    }
    while (cells.length < ncol) cells.push('');
    if (cells.length > ncol) cells = cells.slice(0, ncol);
    const c0 = (cells[0] || '').trim();
    if (c0 === 'report.column.period' || /^report\.column\./i.test(c0)) continue;
    if (!cells.some((c) => c !== '')) continue;
    const o = {};
    header.forEach((h, j) => {
      const k = h && String(h).trim();
      if (k) o[k] = cells[j] ?? '';
    });
    body.push(o);
  }
  if (!body.length) return null;
  log(`CSV repairCjPerformanceCsvPlainNewlines (${ncol} cols, ${body.length} rows)`);
  return body;
}

/**
 * Όταν columns:true έχει ένα μόνο key (= ολόκληρη η κεφαλίδα) αλλά το raw αρχείο έχει κανονικές γραμμές δεδομένων.
 */
function repairPerformanceCsvFromCollapsedMegaKey(raw, megaKey) {
  if (!megaKey || !String(megaKey).includes(',')) return null;
  if (!/report\.column/i.test(megaKey) || !/publisher/i.test(megaKey)) return null;

  let headerNames = splitCjPerformanceHeaderCells(megaKey);
  if (!Array.isArray(headerNames) || headerNames.length < CJ_PERF_CSV_MIN_HEADER_COLS) {
    headerNames = splitCjHeaderCommaList(megaKey);
  }
  if (!headerNames.length || headerNames.length < CJ_PERF_CSV_MIN_HEADER_COLS) return null;
  headerNames = headerNames.map((h) => cleanCjHeaderToken(String(h || '')));
  const ncol = headerNames.length;

  const text = String(raw || '')
    .replace(/^\uFEFF/, '')
    .replace(/\0/g, '')
    .replace(/\uFF0C/g, ',')
    .replace(/[“”]/g, '"')
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
    .replace(/\u2028/g, '\n')
    .replace(/\u2029/g, '\n')
    .trim();
  if (!text) return null;

  const lines = splitCsvLogicalLinesRespectQuotes(text);
  let lineDelim = ',';
  for (const line of lines) {
    if (!line || line.length < 30) continue;
    const low = line.toLowerCase();
    if (low.includes('report.column') && low.includes('publisher')) {
      lineDelim = guessPerfCsvLineDelimiter(line);
      break;
    }
  }

  const isHeaderOnlyPhysicalLine = (line) => {
    const s = String(line || '').trim();
    if (s.length < 40) return false;
    const low = s.toLowerCase();
    if (!low.includes('report.column') || !low.includes('publisher')) return false;
    if (/\b20\d{2}-\d{2}-\d{2}\b/.test(s)) return false;
    if (/\b\d{1,2}\/\d{1,2}\/20\d{2}\b/.test(s)) return false;
    if (/\b\d{1,2}\.\d{1,2}\.20\d{2}\b/.test(s)) return false;
    return true;
  };

  const body = [];
  for (const line of lines) {
    const t = String(line || '').trim();
    if (!t) continue;
    if (isHeaderOnlyPhysicalLine(t)) continue;

    let cells;
    if (lineDelim === ';') {
      cells = splitDelimitedLineRespectQuotes(t, ';');
    } else if (lineDelim === '\t') {
      cells = splitDelimitedLineRespectQuotes(t, '\t');
    } else {
      cells = splitPerformanceDataLine(t, ncol);
    }
    if (!rowLooksLikeCjDataStart(cells) && cells.filter((x) => x !== '').length < Math.min(4, ncol)) {
      cells = splitCjPerfDataLineRobust(t, ncol);
    }
    while (cells.length < ncol) cells.push('');
    if (cells.length > ncol) cells = cells.slice(0, ncol);
    const c0 = (cells[0] || '').trim();
    if (c0 === 'report.column.period' || /^report\.column\./i.test(c0)) continue;
    if (!cells.some((c) => c !== '')) continue;
    const o = {};
    headerNames.forEach((h, j) => {
      const k = h && String(h).trim();
      if (k) o[k] = cells[j] ?? '';
    });
    body.push(o);
  }
  if (body.length) return body;
  const plain = repairCjPerformanceCsvPlainNewlines(text);
  if (plain?.length && Object.keys(plain[0]).length >= CJ_PERF_CSV_MIN_HEADER_COLS) return plain;
  const single = tryManualSingleLineCjPerf(text);
  return single?.length && Object.keys(single[0]).length >= CJ_PERF_CSV_MIN_HEADER_COLS ? single : null;
}

function nonEmptyCsvRows(arr) {
  return Array.isArray(arr) && arr.length ? arr : null;
}

/**
 * Όταν το csv-parse columns:true βλέπει 1 στήλη στην κεφαλίδα, συχνά κρατά μόνο το 1ο κελί ανά γραμμή δεδομένων
 * (χάνονται publisher, clicks κ.λπ.) — το expandCollapsedMegaColumnRows παίρνει κενό/μικρό string και βγάζει 0 γραμμές.
 * Εδώ ξαναδιαβάζουμε το raw με quote-aware γραμμές και σπάμε κάθε data line σε ncol κελιά.
 */
function forceUnwrapCjPerformanceFromRawLines(raw) {
  const text = String(raw || '')
    .replace(/^\uFEFF/, '')
    .replace(/\0/g, '')
    .replace(/\uFF0C/g, ',')
    .replace(/[“”]/g, '"')
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
    .replace(/\u2028/g, '\n')
    .replace(/\u2029/g, '\n')
    .trim();
  if (!text) return null;

  const lines = splitCsvLogicalLinesRespectQuotes(text);
  if (lines.length < 2) {
    return tryManualSingleLineCjPerf(text);
  }

  let headerIdx = -1;
  let header = null;
  for (let i = 0; i < lines.length; i++) {
    const L = lines[i].trim();
    if (L.length < 30) continue;
    const low = L.toLowerCase();
    if (!low.includes('report.column')) continue;
    if (!/publisher/i.test(low)) continue;
    let h = splitCjPerformanceHeaderCells(L).map((x) => cleanCjHeaderToken(String(x || '')));
    if (h.length < CJ_PERF_CSV_MIN_HEADER_COLS) {
      h = splitCjHeaderCommaList(L).map((x) => cleanCjHeaderToken(String(x || '')));
    }
    if (h.length >= CJ_PERF_CSV_MIN_HEADER_COLS) {
      headerIdx = i;
      header = h;
      break;
    }
  }

  if (headerIdx < 0 || !header) return null;

  const ncol = header.length;
  const headerNorm = lines[headerIdx].replace(/\s+/g, ' ').trim();
  const out = [];

  for (let i = headerIdx + 1; i < lines.length; i++) {
    const rawLine = lines[i];
    const line = rawLine.trim();
    if (!line) continue;
    const lineNorm = line.replace(/\s+/g, ' ').trim();
    if (lineNorm === headerNorm) continue;

    let cells;
    const d = guessPerfCsvLineDelimiter(line);
    if (d === ';') cells = splitDelimitedLineRespectQuotes(line, ';');
    else if (d === '\t') cells = splitDelimitedLineRespectQuotes(line, '\t');
    else cells = splitPerformanceDataLine(line, ncol);

    if (!rowLooksLikeCjDataStart(cells) && cells.filter((x) => String(x || '').trim() !== '').length < Math.min(5, ncol)) {
      cells = splitCjPerfDataLineRobust(line, ncol);
    }

    const nonemptyRough = cells.filter((x) => String(x || '').trim() !== '').length;
    if (nonemptyRough < 2 && ncol >= 5) {
      try {
        const rec = parse(line, {
          columns: false,
          relax_quotes: true,
          relax_column_count: true,
          trim: true,
        });
        const first = rec[0];
        if (Array.isArray(first) && first.length >= CJ_PERF_CSV_MIN_HEADER_COLS) {
          cells = first.map((c) => String(c ?? '').trim());
          while (cells.length < ncol) cells.push('');
          if (cells.length > ncol) cells = cells.slice(0, ncol);
        }
      } catch (_) {}
    }

    while (cells.length < ncol) cells.push('');
    if (cells.length > ncol) cells = cells.slice(0, ncol);

    const looksDupHeaderRow =
      header.length === cells.length &&
      header.every(
        (h, j) => normalizeHeaderLookupKey(String(cells[j] ?? '')) === normalizeHeaderLookupKey(String(h ?? ''))
      );
    if (looksDupHeaderRow) continue;

    const c0 = String(cells[0] || '').trim();
    const nonempty = cells.filter((c) => String(c || '').trim() !== '').length;
    if (
      nonempty < 3 &&
      (c0 === 'report.column.period' ||
        (/^report\.column\./i.test(c0) && !/^\d{4}-\d{2}-\d{2}/.test(c0) && !/^\d{1,2}[/.-]\d{1,2}/.test(c0)))
    ) {
      continue;
    }
    if (!cells.some((c) => String(c || '').trim() !== '')) continue;

    const o = {};
    header.forEach((hname, j) => {
      if (hname) o[hname] = cells[j] != null ? cells[j] : '';
    });
    out.push(o);
  }

  if (!out.length) return null;
  log(`CSV forceUnwrap raw lines (${ncol} cols, ${out.length} rows)`);
  return out;
}

/** Όλα τα `"..."` πεδία μιας γραμμής csvx (χωρίς csv-parse — αποφεύγει χαμένα tail fields). */
function extractCsvxDoubleQuotedFields(line) {
  const s = String(line || '');
  const fields = [];
  let i = 0;
  while (i < s.length) {
    if (s[i] !== '"') {
      i++;
      continue;
    }
    i++;
    let buf = '';
    while (i < s.length) {
      if (s[i] === '"') {
        if (s[i + 1] === '"') {
          buf += '"';
          i += 2;
          continue;
        }
        fields.push(buf);
        i++;
        break;
      }
      buf += s[i];
      i++;
    }
  }
  return fields;
}

/**
 * CJ `downloadReportStream.csvx` format:
 * συχνά κάθε φυσική γραμμή είναι 2 στήλες:
 *   col[0] = ολόκληρη κεφαλίδα ("report.column.period,...")
 *   col[1] = payload γραμμής (header repeat ή data csv line)
 * Με columns:true χάνουμε τα υπόλοιπα κελιά, οπότε το ξαναχτίζουμε από το raw.
 */
function parseCjCsvxStreamRows(raw) {
  const text = String(raw || '')
    .replace(/^\uFEFF/, '')
    .replace(/\0/g, '')
    .replace(/\uFF0C/g, ',')
    .replace(/[“”]/g, '"')
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
    .replace(/\u2028/g, '\n')
    .replace(/\u2029/g, '\n')
    .trim();
  if (!text) return null;
  const lines = splitCsvLogicalLinesRespectQuotes(text);
  if (lines.length < 2) return null;

  let header = null;
  let ncol = 0;
  const payloadLines = [];
  let parsedRows = 0;
  let pairRows = 0;
  let parseErrs = 0;

  for (const line of lines) {
    parsedRows++;
    const qf = extractCsvxDoubleQuotedFields(line);
    let row = [];
    if (qf.length >= 2) {
      pairRows++;
      const c0 = String(qf[0] || '').trim();
      const tail = qf
        .slice(1)
        .map((c) => String(c ?? '').trim())
        .filter(Boolean);
      let payload = tail.join(',').trim();
      if (!payload && qf.length > 1) payload = String(qf[1] || '').trim();
      row = [c0, payload];
      const c0q = String(row[0] || '');
      if (!header && /report\.column\./i.test(c0q) && /publisher/i.test(c0q) && c0q.includes(',')) {
        let h = splitCjPerformanceHeaderCells(c0q).map((x) => cleanCjHeaderToken(String(x || '')));
        if (h.length < CJ_PERF_CSV_MIN_HEADER_COLS) {
          h = splitCjHeaderCommaList(c0q).map((x) => cleanCjHeaderToken(String(x || '')));
        }
        if (h.length >= CJ_PERF_CSV_MIN_HEADER_COLS) {
          header = h;
          ncol = h.length;
        }
      }
      if (payload) payloadLines.push(payload);
      continue;
    }

    let rec;
    try {
      rec = parse(line, {
        columns: false,
        relax_quotes: true,
        relax_column_count: true,
        trim: true,
      });
    } catch (_) {
      parseErrs++;
      continue;
    }
    row = Array.isArray(rec?.[0]) ? rec[0].map((c) => String(c ?? '').trim()) : [];
    if (row.length < 2) continue;
    pairRows++;
    const c0 = String(row[0] || '');
    const c1 = String(row[1] || '');
    // In csvx stream, data is often in "all cells after first", not only row[1].
    let payload = row.slice(1).join(',').trim();
    if (!payload) payload = c1;
    if (!header && /report\.column\./i.test(c0) && /publisher/i.test(c0) && c0.includes(',')) {
      let h = splitCjPerformanceHeaderCells(c0).map((x) => cleanCjHeaderToken(String(x || '')));
      if (h.length < CJ_PERF_CSV_MIN_HEADER_COLS) {
        h = splitCjHeaderCommaList(c0).map((x) => cleanCjHeaderToken(String(x || '')));
      }
      if (h.length >= CJ_PERF_CSV_MIN_HEADER_COLS) {
        header = h;
        ncol = h.length;
      }
    }
    if (payload) payloadLines.push(payload);
  }

  // Fallback: raw line extraction of 2nd quoted cell ("header","payload")
  if ((!header || payloadLines.length < 2) && lines.length > 1) {
    const payloadLines2 = [];
    let fallbackPairs = 0;
    for (const line of lines) {
      const t = String(line || '').trim();
      if (!t || t.length < 8) continue;
      // First field is quoted header key; tail may be quoted OR comma table.
      const m = t.match(/^"((?:[^"]|"")*)"\s*,\s*(.*)$/);
      if (!m) continue;
      fallbackPairs++;
      const first = m[1].replace(/""/g, '"').trim();
      let second = String(m[2] || '').trim();
      if (second.startsWith('"') && second.endsWith('"') && second.length >= 2) {
        second = second.slice(1, -1);
      }
      second = second.replace(/""/g, '"').trim();
      if (!header && /report\.column\./i.test(first) && /publisher/i.test(first) && first.includes(',')) {
        let h = splitCjPerformanceHeaderCells(first).map((x) => cleanCjHeaderToken(String(x || '')));
        if (h.length < CJ_PERF_CSV_MIN_HEADER_COLS) {
          h = splitCjHeaderCommaList(first).map((x) => cleanCjHeaderToken(String(x || '')));
        }
        if (h.length >= CJ_PERF_CSV_MIN_HEADER_COLS) {
          header = h;
          ncol = h.length;
        }
      }
      if (second) payloadLines2.push(second);
    }
    if ((!payloadLines.length || payloadLines.length < payloadLines2.length) && payloadLines2.length) {
      payloadLines.length = 0;
      for (const p of payloadLines2) payloadLines.push(p);
    }
    log(`CSV csvx fallback pairs=${fallbackPairs} payload=${payloadLines2.length}`);
  }

  if (payloadLines.length) {
    const p0 = String(payloadLines[0] || '').slice(0, 140);
    const p1 = String(payloadLines[1] || '').slice(0, 140);
    log(`CSV csvx payload samples: [0]=${JSON.stringify(p0)} [1]=${JSON.stringify(p1)}`);
  }
  log(`CSV csvx scan lines=${lines.length} parsed=${parsedRows} parseErrs=${parseErrs} pairRows=${pairRows} payload=${payloadLines.length}`);
  if (!header || ncol < CJ_PERF_CSV_MIN_HEADER_COLS || !payloadLines.length) return null;

  const out = [];
  for (const payload of payloadLines) {
    const p = String(payload || '').trim();
    if (!p) continue;
    if (/^report\.column\./i.test(p)) continue;
    let cells = splitPerformanceDataLine(p, ncol);
    if (!rowLooksLikeCjDataStart(cells) && cells.filter((x) => String(x || '').trim() !== '').length < Math.min(5, ncol)) {
      cells = splitCjPerfDataLineRobust(p, ncol);
    }
    while (cells.length < ncol) cells.push('');
    if (cells.length > ncol) cells = cells.slice(0, ncol);
    if (!cells.some((c) => String(c || '').trim() !== '')) continue;
    const o = {};
    header.forEach((h, i) => {
      if (h) o[h] = cells[i] != null ? cells[i] : '';
    });
    out.push(o);
  }
  if (!out.length) {
    log(
      `CSV csvx: ${ncol} header cols, ${payloadLines.length} payload cell(s), 0 data rows after skip (duplicate header / empty CJ export?)`
    );
    return null;
  }
  log(`CSV parseCjCsvxStreamRows (${ncol} cols, ${out.length} rows)`);
  return out;
}

function parsePerformanceCsv(filePath, dateFrom, dateTo) {
  const raw = readPerformanceCsvFileSync(filePath);
  try {
    const st = fs.statSync(filePath);
    const lineApprox = splitCsvLogicalLinesRespectQuotes(raw).length;
    log(`CSV file size=${st.size} bytes, logicalLines≈${lineApprox}, preview=${JSON.stringify(raw.slice(0, 140))}`);
    const rawPhys = String(raw || '')
      .replace(/\r\n/g, '\n')
      .replace(/\r/g, '\n')
      .split('\n')
      .slice(0, 6);
    for (let i = 0; i < rawPhys.length; i++) {
      const ln = String(rawPhys[i] || '');
      const commaCount = (ln.match(/,/g) || []).length;
      const quoteCount = (ln.match(/"/g) || []).length;
      log(`CSV raw line[${i}] len=${ln.length} commas=${commaCount} quotes=${quoteCount} :: ${JSON.stringify(ln.slice(0, 220))}`);
    }
  } catch (_) {}

  // 1) Raw γραμμές — σώζει όταν το columns:true έχει αφήσει 1 «mega» στήλη και χαμένα κελιά στα δεδομένα.
  // 2) Columnless / manual / … — υπόλοιπα edge cases.
  let rows =
    nonEmptyCsvRows(parseCjCsvxStreamRows(raw)) ||
    nonEmptyCsvRows(forceUnwrapCjPerformanceFromRawLines(raw)) ||
    nonEmptyCsvRows(parsePerformanceCsvFromColumnlessRaw(raw)) ||
    nonEmptyCsvRows(parsePerformanceCsvManualLines(raw)) ||
    nonEmptyCsvRows(repairCjPerformanceCsvPlainNewlines(raw)) ||
    nonEmptyCsvRows(parseCsvRowsAuto(raw)) ||
    [];
  if (rows.length && rows[0] && (looksLikeSingleCjHeaderKeyRow(rows[0]) || isCollapsedCjPerformanceHeaderRow(rows[0]))) {
    const again = reparseCommaTableFromRaw(raw);
    if (again?.length && again[0] && Object.keys(again[0]).length >= 5) {
      log(
        `CSV parsePerformanceCsv: διόρθωση collapsed (${Object.keys(rows[0]).length} key(s) → ${Object.keys(again[0]).length} στήλες, ${again.length} γραμμές)`
      );
      rows = again;
    }
  }
  if (
    rows.length &&
    rows[0] &&
    Object.keys(rows[0]).length === 1 &&
    (isCollapsedCjPerformanceHeaderRow(rows[0]) || looksLikeSingleCjHeaderKeyRow(rows[0]))
  ) {
    const expanded = expandCollapsedMegaColumnRows(rows);
    if (expanded?.length && Object.keys(expanded[0]).length >= CJ_PERF_CSV_MIN_HEADER_COLS) {
      log(
        `CSV parsePerformanceCsv: mega-column expand (${Object.keys(expanded[0]).length} cols, ${expanded.length} rows)`
      );
      rows = expanded;
    }
  }
  if (
    rows.length &&
    rows[0] &&
    Object.keys(rows[0]).length === 1 &&
    (isCollapsedCjPerformanceHeaderRow(rows[0]) || looksLikeSingleCjHeaderKeyRow(rows[0]))
  ) {
    const mk = Object.keys(rows[0])[0];
    const fixed = repairPerformanceCsvFromCollapsedMegaKey(raw, mk);
    if (fixed?.length && Object.keys(fixed[0]).length >= CJ_PERF_CSV_MIN_HEADER_COLS) {
      log(`CSV parsePerformanceCsv: raw mega-key repair (${Object.keys(fixed[0]).length} cols, ${fixed.length} rows)`);
      rows = fixed;
    }
  }
  if (
    rows.length &&
    rows[0] &&
    Object.keys(rows[0]).length === 1 &&
    (isCollapsedCjPerformanceHeaderRow(rows[0]) || looksLikeSingleCjHeaderKeyRow(rows[0]))
  ) {
    const slam = tryManualSingleLineCjPerf(raw);
    if (slam?.length && Object.keys(slam[0]).length >= CJ_PERF_CSV_MIN_HEADER_COLS) {
      log(
        `CSV parsePerformanceCsv: manual single-line after mega-key (${Object.keys(slam[0]).length} cols, ${slam.length} rows)`
      );
      rows = slam;
    }
  }
  if (!rows.length) return [];

  if (
    rows[0] &&
    Object.keys(rows[0]).length === 1 &&
    isMegaCollapsedHeaderObjectKey(Object.keys(rows[0])[0])
  ) {
    const plain = repairCjPerformanceCsvPlainNewlines(raw);
    if (plain?.length && Object.keys(plain[0]).length >= CJ_PERF_CSV_MIN_HEADER_COLS) {
      log(
        `CSV parsePerformanceCsv: plain-newlines after mega-key (${Object.keys(plain[0]).length} cols, ${plain.length} rows)`
      );
      rows = plain;
    }
  }

  // Πρώτη γραμμή μπορεί να είναι τίτλος report — βρες γραμμή που μοιάζει με header.
  const looksLikeHeader = (r) => {
    if (!r || typeof r !== 'object') return false;
    const keys = Object.keys(r);
    // Ένα κλειδί «report.column.period,publisherName,…» περιέχει λέξεις publisher/sale/imps — ΔΕΝ είναι γραμμή δεδομένων.
    if (keys.length === 1 && isMegaCollapsedHeaderObjectKey(keys[0])) return false;
    const joined = keys.join(' ').toLowerCase();
    return (
      joined.includes('publisher') &&
      (joined.includes('click') || joined.includes('sale') || joined.includes('imps'))
    );
  };
  if (!looksLikeHeader(rows[0]) && rows.length > 1) {
    const idx = rows.findIndex(looksLikeHeader);
    if (idx > 0) {
      log(`CSV: skipped ${idx} preamble row(s) before header`);
      rows = rows.slice(idx);
    }
  }

  // Αν όλα τα προηγούμενα βήματα άφησαν ακόμα 1 mega-key, ξανά-expand πριν βρούμε dateCol (αποφυγή «no date column»).
  if (
    rows[0] &&
    Object.keys(rows[0]).length === 1 &&
    isMegaCollapsedHeaderObjectKey(Object.keys(rows[0])[0])
  ) {
    const expandedLate = expandCollapsedMegaColumnRows(rows);
    if (expandedLate?.length && Object.keys(expandedLate[0]).length >= CJ_PERF_CSV_MIN_HEADER_COLS) {
      log(
        `CSV parsePerformanceCsv: mega-column expand before column map (${Object.keys(expandedLate[0]).length} cols, ${expandedLate.length} rows)`
      );
      rows = expandedLate;
    }
  }

  let normalized = buildNormalizedHeaderMap(rows[0]);

  const resolvePerformanceDateCol = () =>
    matchColumnKeyInRow(rows[0], [
      'report.column.period',
      'report.column.day',
      'day',
      'date',
      'period',
      'event date',
      'report date',
    ]) ||
    findColumn(normalized, [
      'day',
      'date',
      'event date',
      'eventdate',
      'transaction date',
      'posting date',
      'period',
      'report.column.period',
      'day (event time zone)',
      'event date (utc)',
      'event date (event time zone)',
      'report date',
    ]) ||
    pickColumnByFuzzy(normalized, ['column.period', 'posting date', 'event date', 'report date'], []) ||
    pickColumnByFuzzy(normalized, ['period'], ['pub', 'commission', 'sale']);

  let dateCol = resolvePerformanceDateCol();
  if (!dateCol) {
    const only = Object.keys(rows[0] || {});
    if (only.length === 1 && only[0].includes(',') && /report\.column\.(period|day)/i.test(only[0]) && /publisher/i.test(only[0])) {
      const rescued = forceUnwrapCjPerformanceFromRawLines(raw);
      if (rescued?.length && Object.keys(rescued[0] || {}).length >= CJ_PERF_CSV_MIN_HEADER_COLS) {
        log('CSV: no date column → retry forceUnwrap from raw');
        rows = rescued;
        normalized = buildNormalizedHeaderMap(rows[0]);
        dateCol = resolvePerformanceDateCol();
      }
    }
  }
  if (!dateCol) {
    log(`CSV: no date column. Headers: ${Object.keys(rows[0]).slice(0, 25).join(' | ')}`);
    return [];
  }

  const publisherIdCol =
    findColumn(normalized, [
      'publisher id',
      'publisherid',
      'publisher cid',
      'publisher company id',
      'company id',
      'website id',
      'websiteid',
      'pid',
      'pub id',
    ]) ||
    pickColumnByFuzzy(
      normalized,
      ['website id', 'publisher id', 'company id', 'publisher cid'],
      ['commission', 'name', 'fee']
    );

  let publisherNameCol =
    matchPublisherNameKey(rows[0]) ||
    findColumn(normalized, [
      'publisher name',
      'publishername',
      'publisher_name',
      'website name',
      'websitename',
    ]) ||
    pickColumnByFuzzy(normalized, ['publishername', 'publisher name', 'website name'], ['id', 'commission', 'fee']);
  if (!publisherNameCol) publisherNameCol = inferPublisherNameColumnFromRow(rows[0]);

  const clicksCol =
    matchColumnKeyInRow(rows[0], ['clicks', 'click count', 'link clicks', '# clicks', 'total clicks']) ||
    findColumn(normalized, [
      'clicks',
      'click count',
      'click count (all)',
      '# clicks',
      'total clicks',
      'link clicks',
    ]) ||
    pickColumnByFuzzy(normalized, ['click'], ['commission', 'rate', 'through']);

  const impressionsCol =
    matchColumnKeyInRow(rows[0], ['imps', 'impressions', 'impression count', 'ad impressions', 'impr']) ||
    findColumn(normalized, [
      'impressions',
      'impression count',
      'impression count (all)',
      'imps',
      'impr',
      'ad impressions',
    ]) ||
    pickColumnByFuzzy(normalized, ['imps', 'impression', 'impr.'], ['commission', 'rate']);

  const transactionsCol =
    findColumn(normalized, [
      'transactions',
      'sales',
      'orders',
      'actions',
      'number of sales',
      '# of actions',
      'no. of actions',
      'number of actions',
      'qty',
      'leads',
      'conversions',
    ]) ||
    pickColumnByFuzzy(
      normalized,
      ['# of action', 'no. of action', 'number of actions', 'orders', 'conversions', 'leads'],
      ['sale amount', 'commission', 'gross', 'net sales', 'revenue', 'rate', 'publisher paid']
    ) ||
    pickColumnByFuzzy(normalized, ['transactions'], ['amount', 'commission', 'revenue']);

  const revenueCol =
    matchColumnKeyInRow(rows[0], ['saleAmount', 'sale amount', 'gross sales', 'net sales', 'revenue']) ||
    findColumn(normalized, [
      'sale amount (usd)',
      'sales (usd)',
      'gross sales (usd)',
      'net sales (usd)',
      'sale amount',
      'saleamount',
      'sales amount',
      'gross sales',
      'net sales',
      'order amount',
      'revenue',
    ]) ||
    pickColumnByFuzzy(normalized, ['saleamount', 'sale amount', 'gross sales', 'net sales', 'revenue'], [
      'commission',
      'pub.',
      'fee',
      'rate',
      'per',
    ]);

  const commissionCol =
    matchColumnKeyInRow(rows[0], [
      'publisherCommission',
      'publisher commission',
      'totalCommission',
      'total commission',
      'commission',
    ]) ||
    findColumn(normalized, [
      'publisher commission (usd)',
      'pub. commission (usd)',
      'publisher commission',
      'publishercommission',
      'total commission (usd)',
      'total commission',
      'totalcommission',
      'commission (usd)',
      'commission',
      'pub commission',
      'earnings',
      'payout',
      'cjfee',
    ]) ||
    pickColumnByFuzzy(normalized, ['publishercommission', 'pub commission', 'commission'], [
      'sale amount',
      'saleamount',
      'gross sales',
      'fee cj',
    ]);

  const cjSalesCountCol = findColumn(normalized, ['sales']);
  const cjLeadsCountCol = findColumn(normalized, ['leads']);

  log(
    `CSV columns → date:${dateCol} pubId:${publisherIdCol || '—'} pubName:${publisherNameCol || '—'} ` +
      `clicks:${clicksCol || '—'} impr:${impressionsCol || '—'} tx:${transactionsCol || '—'} ` +
      `rev:${revenueCol || '—'} comm:${commissionCol || '—'}`
  );
  if (!publisherNameCol && !publisherIdCol) {
    const keys = Object.keys(rows[0]);
    const collapsed = keys.length === 1 && String(keys[0]).includes(',');
    const preview = keys.slice(0, 3).map((k) => (k.length > 100 ? `${k.slice(0, 97)}…` : k));
    log(
      `CSV warning: no resolved publisher column (need publisherName / website name or numeric id)${
        collapsed ? '; header row may still be one collapsed field' : ''
      } — key count ${keys.length}: ${preview.join(' | ')}`
    );
  }

  const from = dateFrom ? String(dateFrom).slice(0, 10) : null;
  const to = dateTo != null && dateTo !== '' ? String(dateTo) : null;
  const toSlice = to ? to.slice(0, 10) : null;

  const out = [];
  for (const row of rows) {
    let rawDate = (row[dateCol] || '').trim();
    if (!rawDate) continue;
    if (rawDate.includes(' - ')) rawDate = rawDate.split(' - ')[0].trim();
    rawDate = rawDate.replace(/^Period:\s*/i, '');

    let dateStr = null;
    if (/^\d{4}-\d{2}-\d{2}/.test(rawDate)) {
      dateStr = rawDate.slice(0, 10);
    } else {
      const d = new Date(rawDate);
      if (!isNaN(d.getTime())) dateStr = d.toISOString().slice(0, 10);
      else dateStr = rawDate.slice(0, 10);
    }

    if (from && dateStr < from) continue;
    if (toSlice && dateStr > toSlice) continue;

    let publisher_id = publisherIdCol ? String(row[publisherIdCol] || '').trim() : '';
    const publisher_name = publisherNameCol
      ? normalizeCjPublisherLabel(String(row[publisherNameCol] || '').trim())
      : '';
    if (!publisher_id && publisher_name) {
      publisher_id = `name:${publisher_name.slice(0, 240)}`;
    }

    let transactions = parseIntCell(transactionsCol ? row[transactionsCol] : 0);
    if (cjSalesCountCol && cjLeadsCountCol) {
      transactions =
        parseIntCell(row[cjSalesCountCol] != null ? row[cjSalesCountCol] : 0) +
        parseIntCell(row[cjLeadsCountCol] != null ? row[cjLeadsCountCol] : 0);
    }

    out.push({
      date: dateStr,
      clicks: parseIntCell(clicksCol ? row[clicksCol] : 0),
      impressions: parseIntCell(impressionsCol ? row[impressionsCol] : 0),
      transactions,
      revenue: parseMoneyCell(revenueCol ? row[revenueCol] : 0),
      commission: parseMoneyCell(commissionCol ? row[commissionCol] : 0),
      publisher_id: publisher_id || null,
      publisher_name: publisher_name || null,
    });
  }
  return out;
}

async function waitForAnyVisibleInRoot(root, selectors, timeoutMs = 90000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    for (const s of selectors) {
      try {
        const loc = root.locator(s).first();
        if (await loc.count()) {
          const v = await loc.isVisible().catch(() => false);
          if (v) return s;
        }
      } catch (_) {}
    }
    await new Promise((r) => setTimeout(r, 1000));
  }
  return null;
}

/**
 * Like Python switch_to_reports_iframe(target): find page or iframe that has report controls.
 * @param {import('playwright').Page} page
 * @param {'performance'} target
 * @returns {Promise<import('playwright').Page|import('playwright').Frame|null>}
 */
async function switchToReportsContext(page, target = 'performance') {
  const locators = TARGET_LOCATORS[target] || TARGET_LOCATORS.performance;

  async function frameHasTarget(frame) {
    return anyLocatorCountPositive(frame, locators);
  }

  async function pickFrameFromTree(frame, depth = 0) {
    if (!frame || depth > 6) return null;
    if (await frameHasTarget(frame)) return frame;
    try {
      const n = await frame.locator('iframe').count();
      for (let j = 0; j < n; j++) {
        const h2 = await frame.locator('iframe').nth(j).elementHandle();
        if (!h2) continue;
        const f2 = await h2.contentFrame();
        await h2.dispose();
        const found = await pickFrameFromTree(f2, depth + 1);
        if (found) return found;
      }
    } catch (_) {}
    return null;
  }

  if (await frameHasTarget(page)) return page;

  // Prefer frames whose URL is the classic reports document (SPA often loads it late).
  for (const f of page.frames()) {
    if (f === page.mainFrame()) continue;
    try {
      if (/reports_js\.cj/i.test(f.url() || '') && (await frameHasTarget(f))) return f;
    } catch (_) {}
  }

  for (const sel of REPORT_IFRAME_SELECTORS) {
    const iframeLoc = page.locator(sel);
    const n = await iframeLoc.count();
    for (let i = 0; i < n; i++) {
      try {
        const handle = await iframeLoc.nth(i).elementHandle();
        if (!handle) continue;
        const frame = await handle.contentFrame();
        await handle.dispose();
        const nested = await pickFrameFromTree(frame, 0);
        if (nested) return nested;
      } catch (_) {}
    }
  }

  for (const f of page.frames()) {
    if (f === page.mainFrame()) continue;
    const nested = await pickFrameFromTree(f, 0);
    if (nested) return nested;
  }
  return null;
}

/**
 * SPA: το iframe reports_js.cj φορτώνει μετά. Περιμένουμε να εμφανιστεί URL ή controls.
 */
async function waitForReportsContext(page, target, timeoutMs = 120000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    const ctx = await switchToReportsContext(page, target);
    if (ctx) return ctx;
    await page.waitForTimeout(600);
  }
  return null;
}

/** Βήμα 3.1 — περιμένει controls μετά το direct nav (~έως όσο το UI χρειάζεται) */
async function waitForPerfInitial(page, timeoutMs = 60000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    if (await anyLocatorCountPositive(page, PERF_INITIAL_WAIT_SELECTORS)) return true;
    await page.waitForTimeout(400);
  }
  return false;
}

async function hasCjReportsErrorState(page) {
  try {
    const txt = (await page.locator('body').innerText().catch(() => '')).toLowerCase();
    if (!txt) return false;
    // Μην ταιριάζεις "loading content" μόνο του — είναι φυσιολογικό loading state.
    return txt.includes('access is denied') || txt.includes('nullpointerexception');
  } catch (_) {
    return false;
  }
}

/** Από DOM links (όχι από advertiser CID) — για σωστό /member/{id}/ … */
async function extractMemberNumericIdFromPage(page) {
  try {
    return await page.evaluate(() => {
      const candidates = [];
      for (const a of document.querySelectorAll('a[href*="members.cj.com/member/"]')) {
        const h = a.getAttribute('href') || '';
        const m = h.match(/\/member\/(\d+)\//);
        if (m) candidates.push(m[1]);
      }
      const loc = window.location.href || '';
      const m2 = loc.match(/\/member\/(\d+)\//);
      if (m2) candidates.unshift(m2[1]);
      const uniq = [...new Set(candidates)];
      return uniq.length ? uniq[0] : null;
    });
  } catch (_) {
    return null;
  }
}

async function clickSidebarReportsThenPerformance(page) {
  try {
    const reportsLink = page
      .locator('nav a[href*="reports"], aside a[href*="reports"], [role="navigation"] a[href*="reports"]')
      .first();
    if (await reportsLink.count()) {
      const vis = await reportsLink.isVisible().catch(() => false);
      if (vis) {
        await jsScrollIntoViewAndClick(reportsLink);
        await page.waitForTimeout(1500);
      }
    }
  } catch (_) {}

  for (const sel of PERFORMANCE_LINK_CANDIDATES) {
    try {
      const loc = page.locator(sel).first();
      if (await loc.count()) {
        const v = await loc.isVisible().catch(() => false);
        if (v) {
          await jsScrollIntoViewAndClick(loc);
          await page.waitForTimeout(2000);
          return true;
        }
      }
    } catch (_) {}
  }

  try {
    const byRole = page.getByRole('link', { name: /^reports$/i }).first();
    if (await byRole.count()) {
      const v = await byRole.isVisible().catch(() => false);
      if (v) {
        await jsScrollIntoViewAndClick(byRole);
        await page.waitForTimeout(1200);
      }
    }
  } catch (_) {}

  try {
    const perf = page.getByRole('link', { name: /performance/i }).first();
    if (await perf.count()) {
      const v = await perf.isVisible().catch(() => false);
      if (v) {
        await jsScrollIntoViewAndClick(perf);
        await page.waitForTimeout(2500);
        return true;
      }
    }
  } catch (_) {}

  return false;
}

async function recoverCjReportsFromHome(page) {
  try {
    // Return to CJ home/dashboard and re-open Reports from in-app navigation.
    const home = page
      .getByRole('link', { name: /home/i })
      .first();
    if (await home.count()) {
      await jsScrollIntoViewAndClick(home);
      await page.waitForTimeout(1200);
    } else {
      const u = page.url();
      if (/members\.cj\.com/i.test(u)) {
        const root = u.match(/https:\/\/members\.cj\.com\/member(?:\/\d+)?/i);
        if (root && root[0]) await safeGoto(page, `${root[0]}/advertiser/home.do`, 30000);
      }
    }
    await waitForPageReady(page, 15000);
    await page.waitForTimeout(1000);
    return true;
  } catch (_) {
    return false;
  }
}

/**
 * Ροή CJ όπως στο UI σου: κουμπί Reports (#adv-insights) → στοιχείο Performance.
 * Χωρίς direct URL στο reports_js — το Chrome «μόνο του» συχνά πάει λάθος route.
 */
async function openPerformanceReportViaAdvInsights(page) {
  try {
    const btn = page.locator('button#adv-insights');
    await btn.waitFor({ state: 'visible', timeout: 60000 });
    await jsScrollIntoViewAndClick(btn);
    log('Clicked button#adv-insights (Reports)');
    await page.waitForTimeout(800);

    const perfSelectors = [
      '#adv-reports-performance',
      'a#adv-reports-performance',
      'a[href*="reports_js"][href*="performance"]',
      'a[href*="#?tab=performance"]',
      'a[href*="tab=performance"]',
    ];
    for (const sel of perfSelectors) {
      try {
        const p = page.locator(sel).first();
        if (await p.count()) {
          const v = await p.isVisible().catch(() => false);
          if (v) {
            await jsScrollIntoViewAndClick(p);
            log(`Opened Performance via selector: ${sel}`);
            await page.waitForTimeout(2800);
            return true;
          }
        }
      } catch (_) {}
    }

    const roleLink = page.getByRole('link', { name: /^performance$/i }).first();
    if (await roleLink.count()) {
      const v = await roleLink.isVisible().catch(() => false);
      if (v) {
        await jsScrollIntoViewAndClick(roleLink);
        log('Opened Performance via getByRole(link)');
        await page.waitForTimeout(2800);
        return true;
      }
    }

    const perfSpan = page.locator('span').filter({ hasText: /^Performance$/ }).first();
    if (await perfSpan.count()) {
      const v = await perfSpan.isVisible().catch(() => false);
      if (v) {
        const ok = await perfSpan.evaluate((el) => {
          const t = el.closest('a,button,[role="menuitem"]');
          if (t) {
            t.click();
            return true;
          }
          const par = el.parentElement;
          if (par && /^A|BUTTON$/i.test(par.tagName)) {
            par.click();
            return true;
          }
          return false;
        });
        if (ok) {
          log('Opened Performance via <span>Performance</span> → parent click');
          await page.waitForTimeout(2800);
          return true;
        }
      }
    }
  } catch (e) {
    log(`openPerformanceReportViaAdvInsights: ${e.message}`);
  }
  return false;
}

async function navigatePerformanceViaMenu(page) {
  log('Performance direct nav failed or timed out; trying Reports dropdown → Performance');
  if (await hasCjReportsErrorState(page)) {
    log('Detected CJ Reports error state; recovering via Home navigation');
    await recoverCjReportsFromHome(page);
  }
  const viaNav = await clickSidebarReportsThenPerformance(page);
  if (viaNav) log('Opened Performance via sidebar / in-app links');
  const dd = await firstVisibleLocator(page, REPORTS_DROPDOWN_SELECTORS);
  if (dd) {
    await jsScrollIntoViewAndClick(dd);
    await page.waitForTimeout(800);
    try {
      await page.waitForSelector('#adv-reports-performance', { timeout: 3000 });
    } catch (_) {}
  }
  const perfLink = await firstVisibleLocator(page, PERFORMANCE_LINK_SELECTORS);
  if (perfLink) {
    const href = await perfLink.getAttribute('href');
    if (href && /^https?:/i.test(href)) await safeGoto(page, href, 45000);
    else await jsScrollIntoViewAndClick(perfLink);
    await page.waitForTimeout(2000);
    return true;
  }
  if (await openPerformanceReportViaAdvInsights(page)) return true;

  const u = page.url();
  if (u.includes('member')) {
    const base = u.split('#')[0];
    await safeGoto(page, `${base}${PERFORMANCE_HASH}`, 60000);
    return true;
  }
  return false;
}

/** Select2 UI μόνο αν native #21–#23 δεν έπιασαν (όχι στον κύριο πίνακα). */
async function select2PickOption(page, root, selectId, textMatchers) {
  const matchers = textMatchers.map((x) => String(x).toLowerCase());

  const viaJs = await root.evaluate(
    ({ selectId: sid, matchers: mch }) => {
      const jq = typeof window !== 'undefined' && window.jQuery;
      const el = document.getElementById(sid);
      if (!el || !el.options || el.options.length === 0) return false;
      for (let i = 0; i < el.options.length; i++) {
        const opt = el.options[i];
        const t = (opt.text || '').toLowerCase();
        const v = (opt.value || '').toLowerCase();
        for (const m of mch) {
          if (t.includes(m) || v.includes(m) || v === m) {
            el.value = opt.value;
            if (jq && jq(el).length) {
              jq(el).val(opt.value);
              try {
                if (jq(el).data('select2') && typeof jq(el).select2 === 'function') {
                  jq(el).select2('val', opt.value);
                }
              } catch (_) {}
              jq(el).trigger('change');
            } else {
              el.dispatchEvent(new Event('change', { bubbles: true }));
            }
            return true;
          }
        }
      }
      return false;
    },
    { selectId, matchers }
  );
  if (viaJs) {
    await page.waitForTimeout(200);
    return true;
  }

  const s2 = root.locator(`#s2id_${selectId}`);
  if (!(await s2.count())) return false;

  await s2
    .locator('a.select2-choice, .select2-choice, .select2-choices')
    .first()
    .click({ timeout: 4000 })
    .catch(async () => {
      await s2.locator('.select2-chosen').first().click({ timeout: 3000 }).catch(() => {});
    });
  await page.waitForTimeout(280);

  async function clickMatchingLi(ctx) {
    const dropSelectors = ['#select2-drop', '.select2-drop.select2-drop-active', '.select2-drop'];
    for (const ds of dropSelectors) {
      const drop = ctx.locator(ds).first();
      if (!(await drop.count())) continue;
      const vis = await drop.isVisible().catch(() => false);
      if (!vis) continue;
      const items = drop.locator('li.select2-result-selectable, li.select2-results__option[role="option"]');
      const n = await items.count();
      for (let i = 0; i < n; i++) {
        const li = items.nth(i);
        const text = ((await li.innerText().catch(() => '')) || '').toLowerCase().replace(/\s+/g, ' ').trim();
        if (!text || text === 'searching…' || text === 'searching...') continue;
        for (const m of matchers) {
          if (text === m || text.includes(m)) {
            await li.click({ timeout: 3500 }).catch(() => {});
            await page.waitForTimeout(220);
            return true;
          }
        }
      }
    }
    // Select2: ανοιχτό listbox χωρίς #select2-drop (έκδοση / z-index)
    const listbox = ctx.locator('ul.select2-results[role="listbox"]').first();
    if (await listbox.count()) {
      const vis = await listbox.isVisible().catch(() => false);
      if (vis) {
        const items = listbox.locator('li.select2-result-selectable');
        const n = await items.count();
        for (let i = 0; i < n; i++) {
          const li = items.nth(i);
          const label = li.locator('.select2-result-label').first();
          const raw =
            ((await label.innerText().catch(() => '')) || (await li.innerText().catch(() => '')) || '')
              .toLowerCase()
              .replace(/\s+/g, ' ')
              .trim();
          if (!raw) continue;
          for (const m of matchers) {
            if (raw === m || raw.includes(m)) {
              await li.click({ timeout: 3500 }).catch(() => {});
              await page.waitForTimeout(220);
              return true;
            }
          }
        }
      }
    }
    return false;
  }

  // Το dropdown συχνά κάνει append στο main document, όχι στο iframe.
  if (await clickMatchingLi(root)) return true;
  if (await clickMatchingLi(page)) return true;

  await page.keyboard.press('Escape').catch(() => {});
  return false;
}

/** Γραμμές #21–#23: Select2 όπως στο CJ UI — Publisher → Daily → Last 30 days, μετά Run/Download. */
async function setPerformanceForm(root, page) {
  log('Performance form: Select2 Publisher → Daily → Last 30 days (+ native fallback)');

  await root
    .evaluate(() => {
      const jq = typeof window !== 'undefined' && window.jQuery;
      const setVal = (id, val) => {
        const el = document.getElementById(id);
        if (!el) return;
        if (jq && jq(`#${id}`).length) {
          jq(`#${id}`).val(val).trigger('change');
        } else {
          el.value = val;
          el.dispatchEvent(new Event('change', { bubbles: true }));
        }
      };
      setVal('performanceReportNameSelect', 'publisher');
      setVal('performanceReportTrendPeriodSelect', 'DoD');
      const daySel = document.getElementById('performanceReportDateDaySelect');
      if (daySel) {
        setVal('performanceReportDateDaySelect', 'Last30Days');
        for (let i = 0; i < daySel.options.length; i++) {
          const t = (daySel.options[i].text || '').toLowerCase();
          if (t.includes('30') || t.includes('last 30')) {
            if (jq && jq('#performanceReportDateDaySelect').length) {
              jq('#performanceReportDateDaySelect').val(daySel.options[i].value).trigger('change');
            } else {
              daySel.value = daySel.options[i].value;
              daySel.dispatchEvent(new Event('change', { bubbles: true }));
            }
            break;
          }
        }
      }
    })
    .catch(() => {});

  await page.waitForTimeout(350);

  // Select2: μία προσπάθεια + δεύτερη μόνο αν απέτυχε (το διπλό pick σε κάθε dropdown καθυστερούσε ~2–3 λεπτά).
  const pickOnce = async (id, matchers, label) => {
    const ok = await select2PickOption(page, root, id, matchers);
    if (!ok) {
      log(`Select2 retry: ${label}`);
      await select2PickOption(page, root, id, matchers);
    }
    await page.waitForTimeout(160);
  };
  await pickOnce('performanceReportNameSelect', ['publisher'], 'Publisher');
  await pickOnce('performanceReportTrendPeriodSelect', ['daily', 'dod', 'day over', 'day-over', 'day over day'], 'Daily');
  await pickOnce('performanceReportDateDaySelect', ['last 30', '30 day', 'last30', 'last 30 days'], 'Last 30 days');

  try {
    await root.locator('#performanceReportNameSelect').selectOption('publisher');
  } catch (_) {}
  try {
    await root.locator('#performanceReportTrendPeriodSelect').selectOption('DoD');
  } catch (_) {}
  try {
    await root.locator('#performanceReportDateDaySelect').selectOption('Last30Days');
  } catch (_) {
    try {
      await root.locator('#performanceReportDateDaySelect').selectOption({ label: 'Last 30 Days' });
    } catch (_) {
      try {
        await root.locator('#performanceReportDateDaySelect').selectOption({ label: '30 Days' });
      } catch (_) {
        try {
          await root.locator('#performanceReportDateDaySelect').selectOption({ label: /30/i });
        } catch (_) {}
      }
    }
  }

  await page.waitForTimeout(400);
}

/** Γραμμή #24 / #38 — RUN REPORT */
async function clickRunReport(root, page) {
  const explicitRun = root.locator('#performanceReportRunButton');
  try {
    if (await explicitRun.count()) {
      const vis = await explicitRun.isVisible().catch(() => false);
      if (vis) {
        await jsScrollIntoViewAndClick(explicitRun);
        log('Clicked Run Report (#performanceReportRunButton)');
        await waitForAnyVisibleInRoot(root, POST_RUN_DOWNLOAD_UI_WAIT, 28000).catch(() => {});
        await page.waitForTimeout(1800);
        return true;
      }
    }
  } catch (_) {}

  for (const sel of RUN_REPORT_SELECTORS) {
    try {
      const runBtn = root.locator(sel).first();
      if (!(await runBtn.count())) continue;
      const v = await runBtn.isVisible().catch(() => false);
      if (!v) continue;
      await jsScrollIntoViewAndClick(runBtn);
      log('Clicked Run Report (xpath fallback)');
      await waitForAnyVisibleInRoot(root, POST_RUN_DOWNLOAD_UI_WAIT, 45000).catch(() => {});
      await page.waitForTimeout(3000);
      return true;
    } catch (_) {}
  }
  return false;
}

/** Βήμα 3.8 — modal ui-dialog-buttonset */
async function confirmModalDownload(page) {
  const modalBtn = page.locator(MODAL_DOWNLOAD).first();
  if (await modalBtn.count()) await jsScrollIntoViewAndClick(modalBtn);
}

/**
 * Βήμα 3.7 / 4.4 — δοκιμάζει download selectors διαδοχικά (όχι union selector),
 * όπως το cj.py πρώτο clickable.
 * Προσοχή: παλιά κάθε selector περίμενε 90s για download — 10+ selectors = 10+ λεπτά χωρίς log.
 */
async function downloadReportToFile(page, root, downloadSelectors, downloadDir, label) {
  await waitForAnyVisibleInRoot(root, downloadSelectors, 90000);
  const context = page.context();
  // Collect possible export URLs emitted by CJ after clicking Download.
  const observedExportUrls = new Set();
  const rememberUrl = (u) => {
    const s = String(u || '');
    if (!s) return;
    if (/download|export|csv|xlsx?|report/i.test(s)) observedExportUrls.add(s);
  };
  const onRequestFinished = (req) => {
    try {
      rememberUrl(req?.url?.());
    } catch (_) {}
  };
  const onResponse = (resp) => {
    try {
      rememberUrl(resp?.url?.());
      const h = resp?.headers?.() || {};
      const ct = String(h['content-type'] || h['Content-Type'] || '').toLowerCase();
      const cd = String(h['content-disposition'] || h['Content-Disposition'] || '').toLowerCase();
      if (ct.includes('csv') || ct.includes('spreadsheet') || cd.includes('attachment') || cd.includes('.csv')) {
        rememberUrl(resp?.url?.());
      }
    } catch (_) {}
  };
  page.on('requestfinished', onRequestFinished);
  page.on('response', onResponse);
  const cleanupObservers = () => {
    try {
      page.off('requestfinished', onRequestFinished);
    } catch (_) {}
    try {
      page.off('response', onResponse);
    } catch (_) {}
  };

  const clickCsvOptionIfPresent = async () => {
    const csvCandidates = [
      'text=/\\bCSV\\b/i',
      'text=/comma.?separated/i',
      'text=/\\.csv\\b/i',
      '[role="menuitem"]:has-text("CSV")',
      'li:has-text("CSV")',
      'button:has-text("CSV")',
      'a:has-text("CSV")',
      '.dropdown-menu a:has-text("CSV")',
      '.dropdown-menu button:has-text("CSV")',
      '.ui-menu-item:has-text("CSV")',
    ];
    for (const sel of csvCandidates) {
      const inRoot = root.locator(sel).first();
      if (await inRoot.count()) {
        const v = await inRoot.isVisible().catch(() => false);
        if (v) {
          await jsScrollIntoViewAndClick(inRoot).catch(() => {});
          log(`Clicked CSV option via root selector: ${sel}`);
          return true;
        }
      }
      const inPage = page.locator(sel).first();
      if (await inPage.count()) {
        const v = await inPage.isVisible().catch(() => false);
        if (v) {
          await jsScrollIntoViewAndClick(inPage).catch(() => {});
          log(`Clicked CSV option via page selector: ${sel}`);
          return true;
        }
      }
    }
    return false;
  };

  const tryClickControl = async (loc, sel) => {
    await loc.scrollIntoViewIfNeeded().catch(() => {});
    const forceIcon = /i-cj-download|\.i\.i-/.test(sel);
    await loc
      .click({ timeout: 5000, force: forceIcon })
      .catch(async () => {
        await jsScrollIntoViewAndClick(loc);
      });
    // Some CJ download buttons open a format dropdown (CSV/XLSX). Pick CSV explicitly.
    await page.waitForTimeout(300);
    await clickCsvOptionIfPresent().catch(() => {});
    await confirmModalDownload(page);
    await page.waitForTimeout(200);
    await clickCsvOptionIfPresent().catch(() => {});
  };

  const safeBasename = (name) =>
    String(name || `${label}.csv`)
      .replace(/[/\\?%*:|"<>]/g, '_')
      .replace(/,/g, '_')
      .replace(/\s+/g, '_')
      .slice(0, 200) || `${label}.csv`;

  const saveDownload = async (download) => {
    const name = safeBasename(download.suggestedFilename());
    const dest = path.join(downloadDir, name);
    await download.saveAs(dest);
    let sz = 0;
    try {
      sz = fs.statSync(dest).size;
    } catch (_) {}
    log(`Downloaded (${label}): ${dest} (${sz} bytes)`);
    return dest;
  };

  const saveRawBufferAsFile = (buf, ext = 'csv') => {
    const stamp = Date.now();
    const name = safeBasename(`${label}_${stamp}.${ext}`);
    const dest = path.join(downloadDir, name);
    fs.writeFileSync(dest, buf);
    let sz = 0;
    try {
      sz = fs.statSync(dest).size;
    } catch (_) {}
    log(`Downloaded (${label}) [captured-response]: ${dest} (${sz} bytes)`);
    return dest;
  };

  // Python parity: sometimes browser download event is missed, but file still lands in download dir.
  const snapshotDownloadDir = () => {
    /** @type {Map<string, {mtimeMs:number,size:number}>} */
    const out = new Map();
    try {
      for (const name of fs.readdirSync(downloadDir)) {
        try {
          const st = fs.statSync(path.join(downloadDir, name));
          out.set(name, { mtimeMs: Number(st.mtimeMs || 0), size: Number(st.size || 0) });
        } catch (_) {}
      }
    } catch (_) {
      // noop
    }
    return out;
  };

  const waitForFileInDownloadDir = async (beforeMap, timeoutMs = 45000) => {
    const started = Date.now();
    let debugTick = 0;
    while (Date.now() - started < timeoutMs) {
      let now = [];
      try {
        now = fs.readdirSync(downloadDir);
      } catch (_) {
        now = [];
      }
      for (const name of now) {
        const low = String(name || '').toLowerCase();
        if (!(low.endsWith('.csv') || low.endsWith('.xlsx'))) continue;
        if (low.endsWith('.crdownload') || low.endsWith('.tmp') || low.endsWith('.part')) continue;
        const full = path.join(downloadDir, name);
        try {
          const st = fs.statSync(full);
          if (!st || st.size <= 0) continue;
          const prev = beforeMap.get(name);
          const isNew = !prev;
          const changed = !!prev && (Number(st.mtimeMs || 0) > prev.mtimeMs || Number(st.size || 0) !== prev.size);
          if (isNew || changed) {
            log(`Downloaded (${label}) [fs-poll]: ${full} (${st.size} bytes)`);
            return full;
          }
        } catch (_) {}
      }
      if (debugTick % 10 === 0) {
        const filesPreview = now.slice(0, 8).join(', ');
        log(`fs-poll waiting (${Math.round((Date.now() - started) / 1000)}s): ${filesPreview || 'no files'}`);
      }
      debugTick++;
      await page.waitForTimeout(500);
    }
    return null;
  };

  const fetchExportFromObservedUrls = async () => {
    const cands = Array.from(observedExportUrls);
    for (const u of cands) {
      try {
        const r = await context.request.get(u, { timeout: 30000 }).catch(() => null);
        if (!r || !r.ok()) continue;
        const h = r.headers() || {};
        const ct = String(h['content-type'] || h['Content-Type'] || '').toLowerCase();
        const cd = String(h['content-disposition'] || h['Content-Disposition'] || '').toLowerCase();
        const looksFile =
          ct.includes('csv') ||
          ct.includes('spreadsheet') ||
          cd.includes('attachment') ||
          cd.includes('.csv') ||
          /\.csvx?(\?|$)/i.test(u) ||
          /\.xlsx?(\?|$)/i.test(u);
        if (!looksFile) continue;
        let body = await r.body();
        if (/downloadReportStream\.csvx/i.test(u) && body && csvxBodyLooksHeaderOnlyOrEmpty(body)) {
          const better = await fetchCjPerformanceStreamWithRetry(context, u, (m) => log(m));
          if (better?.length) body = better;
        }
        if (body && body.length > 0) {
          const ext = ct.includes('sheet') || /\.xlsx?(\?|$)/i.test(u) ? 'xlsx' : 'csv';
          log(`Downloaded (${label}) [request-get]: ${u}`);
          return { __buffer: body, __ext: ext };
        }
      } catch (_) {}
    }
    return null;
  };

  /** Λίγες προσπάθειες με αυξανόμενο timeout — όχι 90s × όλα τα selectors. */
  const DOWNLOAD_WAIT_MS = [22000, 22000, 28000, 40000, 65000, 90000];

  const tryDownloadFrom = async (container, sel, timeoutMs, attemptLabel) => {
    const loc = container.locator(sel).first();
    if (!(await loc.count())) return null;
    let vis = await loc.isVisible().catch(() => false);
    if (!vis && /i-cj-download|ancestor::button/.test(sel)) {
      vis = (await loc.count()) > 0;
    }
    if (!vis) return null;
    log(`${attemptLabel} ${String(sel).slice(0, 95)} — wait ${Math.round(timeoutMs / 1000)}s for download event`);
    const beforeMap = snapshotDownloadDir();
    const downloadPromise = context.waitForEvent('download', { timeout: timeoutMs }).catch(() => null);
    const popupPromise = page.waitForEvent('popup', { timeout: timeoutMs }).catch(() => null);
    const responsePromise = page
      .waitForResponse((resp) => {
        try {
          const u = String(resp.url() || '');
          const h = resp.headers() || {};
          const ct = String(h['content-type'] || h['Content-Type'] || '').toLowerCase();
          const cd = String(h['content-disposition'] || h['Content-Disposition'] || '').toLowerCase();
          return (
            /\.csvx?(\?|$)/i.test(u) ||
            ct.includes('text/csv') ||
            ct.includes('application/csv') ||
            ct.includes('spreadsheet') ||
            cd.includes('attachment') ||
            cd.includes('.csv')
          );
        } catch (_) {
          return false;
        }
      }, { timeout: timeoutMs })
      .catch(() => null);
    try {
      await tryClickControl(loc, sel);
    } catch (_) {}
    const [download, popup, csvResp] = await Promise.all([downloadPromise, popupPromise, responsePromise]);
    if (download) return download;
    if (csvResp) {
      try {
        const buf = await csvResp.body();
        if (buf && buf.length) return { __buffer: buf, __ext: 'csv' };
      } catch (e) {
        // Some CJ/XHR responses are not retrievable via CDP body API; continue with popup/fs fallbacks.
        log(`CSV response capture skipped: ${e.message}`);
      }
    }
    if (popup) {
      try {
        const popUrl = String(popup.url() || '');
        if (/\.csvx?(\?|$)/i.test(popUrl)) {
          const buf = await fetchCjPerformanceStreamWithRetry(context, popUrl, (m) => log(m));
          if (buf?.length) return { __buffer: buf, __ext: 'csv' };
          const r = await context.request.get(popUrl, { timeout: Math.min(timeoutMs, 30000) }).catch(() => null);
          if (r && r.ok()) return { __buffer: await r.body(), __ext: 'csv' };
        }
        await popup.waitForLoadState('domcontentloaded', { timeout: 10000 }).catch(() => {});
        const txt = await popup.locator('body').innerText().catch(() => '');
        if (txt && txt.includes(',') && /report\.column|publisher|click/i.test(txt)) {
          return { __buffer: Buffer.from(txt, 'utf8'), __ext: 'csv' };
        }
      } catch (_) {}
    }
    // Python-like fallback: even without event, check if a new file appeared in download folder.
    const landed = await waitForFileInDownloadDir(beforeMap, Math.min(timeoutMs, 45000));
    if (landed) return { __path: landed };
    // Playwright-native fallback: use observed export URLs with authenticated request context.
    const viaReq = await fetchExportFromObservedUrls();
    if (viaReq) return viaReq;
    return null;
  };

  let phase = 0;
  for (const sel of downloadSelectors) {
    if (phase >= DOWNLOAD_WAIT_MS.length) break;
    const d = await tryDownloadFrom(root, sel, DOWNLOAD_WAIT_MS[phase], `Download [iframe ${phase + 1}/${DOWNLOAD_WAIT_MS.length}]`);
    if (d) {
      if (d.__path) {
        cleanupObservers();
        return d.__path;
      }
      if (d.__buffer) {
        const out = saveRawBufferAsFile(d.__buffer, d.__ext || 'csv');
        cleanupObservers();
        return out;
      }
      const out = await saveDownload(d);
      cleanupObservers();
      return out;
    }
    const loc = root.locator(sel).first();
    if ((await loc.count()) && ((await loc.isVisible().catch(() => false)) || /i-cj-download|ancestor::button/.test(sel))) {
      phase++;
    }
  }

  log('No download from iframe; retry on main page (same selectors)');
  phase = 0;
  const PAGE_TRIES = [
    '#performanceReportDownloadButton',
    '#performanceDownloadButton',
    '#performanceReportExportButton',
    'button.downloadButton',
    'xpath=//i[contains(@class,"download")]/ancestor::button[1]',
  ];
  for (const sel of PAGE_TRIES) {
    if (phase >= 2) break;
    const d = await tryDownloadFrom(page, sel, phase === 0 ? 35000 : 55000, `Download [main page ${phase + 1}/2]`);
    if (d) {
      if (d.__path) {
        cleanupObservers();
        return d.__path;
      }
      if (d.__buffer) {
        const out = saveRawBufferAsFile(d.__buffer, d.__ext || 'csv');
        cleanupObservers();
        return out;
      }
      const out = await saveDownload(d);
      cleanupObservers();
      return out;
    }
    if (await page.locator(sel).first().count()) phase++;
  }

  // Final attempt before failing: fetch via any observed export URL.
  const finalViaReq = await fetchExportFromObservedUrls();
  if (finalViaReq) {
    if (finalViaReq.__buffer) {
      const out = saveRawBufferAsFile(finalViaReq.__buffer, finalViaReq.__ext || 'csv');
      cleanupObservers();
      return out;
    }
  }
  cleanupObservers();
  log(
    'No Playwright download event (CJ may need manual export, or export opens a new tab). Try CJ_SCRAPER_HEADLESS=false.'
  );
  return null;
}

async function waitManualLogin(page, timeoutMs = 300000) {
  log('Manual login window: complete MFA in browser if needed (up to 300s)');
  try {
    await page.waitForFunction(
      () =>
        (typeof window !== 'undefined' &&
          window.location.href &&
          window.location.href.toLowerCase().includes('members.cj.com/member')) ||
        !!document.getElementById('adv-insights'),
      { timeout: timeoutMs }
    );
    return true;
  } catch (_) {
    return false;
  }
}

/**
 * @param {Object} options
 * @param {string} options.username
 * @param {string} options.password
 * @param {number} options.merchant_id
 * @param {string} [options.merchant_name]
 * @param {string|number} [options.advertiser_member_id] — member id in CJ URLs (NOT advertiser CID when they differ)
 * @param {string} [options.date_from] YYYY-MM-DD filter on parsed CSV rows
 * @param {string} [options.date_to] YYYY-MM-DD filter on parsed CSV rows
 * @param {boolean} [options.is_first_fetch] — logged only (Python uses for date window; UI stays Last 30 Days)
 * @param {Function} options.upsert — aggregated `performance_daily` (ανά ημέρα)
 * @param {Function} [options.upsertPublisherDaily] — γραμμές CSV «by publisher» → `performance_publisher_daily`
 */
export async function runCjPerformanceScraper({
  username,
  password,
  merchant_id,
  merchant_name,
  advertiser_member_id,
  date_from,
  date_to,
  is_first_fetch,
  upsert,
  upsertPublisherDaily,
}) {
  if (!username || !password) {
    return { success: false, count: 0, error: 'CJ Brand Manager credentials (username/password) required' };
  }
  if (typeof upsert !== 'function') {
    return { success: false, count: 0, error: 'upsert callback required' };
  }

  if (is_first_fetch) log('is_first_fetch=true (UI report still uses Last 30 Days; optional date filter applies after CSV parse)');

  const downloadDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cj-perf-'));
  let browser;

  const headless = String(process.env.CJ_SCRAPER_HEADLESS || 'false').toLowerCase() === 'true';
  const manualAllowed = !headless;

  try {
    browser = await chromium.launch({
      headless,
      args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'],
    });

    const context = await browser.newContext({
      acceptDownloads: true,
      viewport: { width: 1280, height: 720 },
      userAgent:
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/119.0.0.0 Safari/537.36',
    });

    const page = await context.newPage();

    // --- Login (same URL / selector strategy as Python) ---
    let loginOk = false;
    for (const loginUrl of LOGIN_URLS) {
      try {
        log(`Trying login URL: ${loginUrl}`);
        await page.goto(loginUrl, { waitUntil: 'domcontentloaded', timeout: 25000 });
        await waitForPageReady(page);
        await page.waitForTimeout(500);

        let currentUrl = page.url();
        if (currentUrl.includes('www.cj.com') && !/login|member/i.test(currentUrl.toLowerCase())) {
          const loginLink = await findLoginLinkOnPage(page);
          if (loginLink) {
            const href = await loginLink.getAttribute('href');
            if (href && /^https?:\/\//i.test(href)) await safeGoto(page, href, 35000);
            else {
              await jsScrollIntoViewAndClick(loginLink);
              await page.waitForTimeout(1500);
            }
          }
        }

        let usernameEl = await firstVisibleLocator(page, USERNAME_SELECTORS);
        if (!usernameEl) {
          const allInputs = page.locator('input');
          const ic = await allInputs.count();
          for (let i = 0; i < Math.min(ic, 40); i++) {
            const inp = allInputs.nth(i);
            const vis = await inp.isVisible().catch(() => false);
            if (!vis) continue;
            const typ = ((await inp.getAttribute('type')) || '').toLowerCase();
            const id = ((await inp.getAttribute('id')) || '').toLowerCase();
            const name = ((await inp.getAttribute('name')) || '').toLowerCase();
            const ph = ((await inp.getAttribute('placeholder')) || '').toLowerCase();
            const loginLike = /user|email|login|cid|account/.test(`${id} ${name} ${ph}`);
            if (typ === 'email' || typ === 'text' || loginLike) {
              usernameEl = inp;
              break;
            }
          }
        }

        if (!usernameEl) {
          const dash = await firstVisibleLocator(page, DASHBOARD_SELECTORS_MAIN);
          const insights = await page.locator('#adv-insights').count();
          if (dash || insights) {
            loginOk = true;
            break;
          }
          continue;
        }

        await usernameEl.fill(username).catch(async () => {
          await usernameEl.click().catch(() => {});
          await usernameEl.type(username, { delay: 25 }).catch(() => {});
        });
        await page.waitForTimeout(400);

        const nextBtn = await firstVisibleLocator(page, NEXT_BUTTON_SELECTORS);
        const urlBeforeNext = page.url();
        if (nextBtn) {
          await jsScrollIntoViewAndClick(nextBtn);
          await page.waitForTimeout(1800);
          try {
            await page.waitForFunction((u) => window.location.href !== u, urlBeforeNext, { timeout: 15000 });
          } catch (_) {}
          try {
            await page.waitForSelector('input[type="password"]', { state: 'visible', timeout: 12000 });
          } catch (_) {}
        }

        let passwordEl = await findPasswordInFrames(page);
        if (!passwordEl && manualAllowed) {
          const manualOk = await waitManualLogin(page, 300000);
          if (manualOk) {
            loginOk = true;
            break;
          }
          continue;
        }
        if (!passwordEl) continue;

        await passwordEl.fill(password).catch(async () => {
          await passwordEl.click().catch(() => {});
          await passwordEl.type(password, { delay: 25 }).catch(() => {});
        });
        await page.waitForTimeout(350);

        const submitBtn = await findLoginSubmitButton(page);
        if (submitBtn) await jsScrollIntoViewAndClick(submitBtn);

        try {
          await page.waitForFunction(
            () =>
              window.location.href.toLowerCase().includes('members.cj.com/member') ||
              !!document.getElementById('adv-insights'),
            { timeout: 60000 }
          );
        } catch (_) {}

        await page.waitForTimeout(1500);

        const errVis = await firstVisibleLocator(page, ERROR_MESSAGE_SELECTORS);
        if (errVis) {
          const t = (await errVis.innerText().catch(() => '')).trim();
          if (t) log(`Login UI error (try next URL): ${t.slice(0, 200)}`);
          continue;
        }

        const url = page.url();
        const verifyDash = await firstVisibleLocator(page, DASHBOARD_SELECTORS_VERIFY);
        if (
          url.toLowerCase().includes('members.cj.com/member') ||
          (await page.locator('#adv-insights').count()) > 0 ||
          verifyDash
        ) {
          loginOk = true;
          log(`Login succeeded. URL: ${url}`);
          break;
        }
      } catch (e) {
        log(`Login attempt failed for ${loginUrl}: ${e.message}`);
      }
    }

    if (!loginOk) {
      await browser.close().catch(() => {});
      return { success: false, count: 0, error: 'CJ login failed. Check credentials, MFA, or set CJ_SCRAPER_HEADLESS=false for manual login.' };
    }

    // Member URL id (όχι advertiser CID): από τρέχον URL ή από links στη σελίδα μετά το login.
    await page.waitForTimeout(500);
    let memberId = null;
    try {
      const u = page.url();
      const m = u.match(/\/member\/(\d+)/);
      if (m) memberId = m[1];
    } catch (_) {}
    if (!memberId) memberId = await extractMemberNumericIdFromPage(page);
    if (memberId) log(`Resolved member id for reports URL: ${memberId}`);
    else log('Could not resolve numeric /member/{id}; using member-less reports URL');

    const performanceBasePrimary = memberId
      ? `https://members.cj.com/member/${memberId}/advertiser/reports_js.cj`
      : 'https://members.cj.com/member/advertiser/reports_js.cj';
    const performanceBaseFallback = 'https://members.cj.com/member/advertiser/reports_js.cj';
    const performanceUrl = `${performanceBasePrimary}${PERFORMANCE_HASH}`;
    const performanceUrlFallback = `${performanceBaseFallback}${PERFORMANCE_HASH}`;

    log('Step 1: Reports button #adv-insights → Performance (όπως στο CJ UI σου — όχι random URL πρώτα)');
    let openedShell = await openPerformanceReportViaAdvInsights(page);
    if (!openedShell) {
      log('Δεν άνοιξε από #adv-insights· fallback: direct reports_js URL');
      let perfOk = await safeGoto(page, performanceUrl, 90000);
      if (!perfOk && performanceUrlFallback !== performanceUrl) {
        log(`Performance fallback URL: ${performanceUrlFallback}`);
        perfOk = await safeGoto(page, performanceUrlFallback, 90000);
      }
    }
    if (await hasCjReportsErrorState(page)) {
      log('CJ error μετά το άνοιγμα Reports· Home + ξανά #adv-insights');
      await recoverCjReportsFromHome(page);
      openedShell = await openPerformanceReportViaAdvInsights(page);
      if (!openedShell) await navigatePerformanceViaMenu(page);
    }

    let initial = await waitForPerfInitial(page, 45000);
    if (!initial) {
      await openPerformanceReportViaAdvInsights(page).catch(() => {});
      await navigatePerformanceViaMenu(page);
      initial = await waitForPerfInitial(page, 45000);
    }
    if (!initial) log('Warning: performance controls not on main document yet; waiting for iframe…');

    await page.waitForLoadState('networkidle', { timeout: 25000 }).catch(() => {});
    await page.waitForTimeout(2000);

    let root = await waitForReportsContext(page, 'performance', 120000);
    if (!root) {
      log('No performance report context after wait; menu + URL retry');
      await navigatePerformanceViaMenu(page);
      await safeGoto(page, performanceUrl, 70000).catch(() => {});
      await page.waitForTimeout(3000);
      root = await waitForReportsContext(page, 'performance', 90000);
    }
    if (!root) {
      await browser.close().catch(() => {});
      return {
        success: false,
        count: 0,
        error:
          'Could not find Performance report iframe/controls. Run with CJ_SCRAPER_HEADLESS=false and complete any CJ UI prompts; ensure Reports → Performance loads in the browser.',
      };
    }

    try {
      await root.locator('#performanceReportNameSelect').waitFor({ state: 'attached', timeout: 25000 });
    } catch (_) {
      log('Warning: #performanceReportNameSelect not found after iframe switch (continuing)');
    }

    await setPerformanceForm(root, page);
    await clickRunReport(root, page);
    await waitAfterRunBeforePerformanceDownload(root, page);
    // Short hint-only wait: CJ grid DOM often has no plain YYYY-MM-DD text (localized Period),
    // while the export stream still fills after run — long waits here only slow every fetch.
    await waitForPerformanceGridHasData(root, page, 20000).catch(() => {});

    let perfCsvPath = await downloadReportToFile(page, root, PERF_DOWNLOAD_SELECTORS, downloadDir, 'performance');
    let totalStored = 0;
    let dailyDaysScraped = 0;
    let publisherDailyRowsScraped = 0;
    let hadPerformanceFile = !!(perfCsvPath && fs.existsSync(perfCsvPath));
    if (hadPerformanceFile) {
      const rows = parsePerformanceCsv(perfCsvPath, date_from, date_to);
      const network = 'cj';
      const byDate = new Map();
      let publisherRowsStored = 0;

      for (const row of rows) {
        let pid = row.publisher_id ? String(row.publisher_id).trim() : '';
        const pname = row.publisher_name ? String(row.publisher_name).trim() : '';
        if (!pid && pname) pid = `name:${pname.slice(0, 240).replace(/\s+/g, ' ')}`;
        if (typeof upsertPublisherDaily === 'function' && pid) {
          upsertPublisherDaily(merchant_id, network, row.date, pid, pname, {
            clicks: row.clicks,
            impressions: row.impressions,
            actions: row.transactions,
            revenue: row.revenue,
            commission: row.commission,
          });
          publisherRowsStored++;
        }
        const agg = byDate.get(row.date) || {
          clicks: 0,
          impressions: 0,
          transactions: 0,
          revenue: 0,
          commission: 0,
        };
        agg.clicks += row.clicks;
        agg.impressions += row.impressions;
        agg.transactions += row.transactions;
        agg.revenue += row.revenue;
        agg.commission += row.commission;
        byDate.set(row.date, agg);
      }

      for (const [dateStr, agg] of byDate) {
        upsert(merchant_id, network, dateStr, agg);
      }

      dailyDaysScraped = byDate.size;
      publisherDailyRowsScraped = publisherRowsStored;
      totalStored = publisherRowsStored > 0 ? publisherRowsStored : byDate.size;
      try {
        fs.unlinkSync(perfCsvPath);
      } catch (_) {}
      log(
        `Stored ${publisherRowsStored} performance_publisher_daily rows, ${byDate.size} aggregated days in performance_daily`
      );
    } else {
      log('Performance CSV download missing or failed');
    }

    log('Performance scrape done (no Transactions tab — skipped by design)');
    await browser.close().catch(() => {});
    browser = null;

    try {
      fs.readdirSync(downloadDir).forEach((f) => fs.unlinkSync(path.join(downloadDir, f)));
      fs.rmdirSync(downloadDir);
    } catch (_) {}

    if (!hadPerformanceFile) {
      return { success: false, count: 0, daily_days: 0, publisher_daily_rows: 0, error: 'Could not download Performance report (CSV).' };
    }
    return {
      success: true,
      count: totalStored,
      daily_days: dailyDaysScraped,
      publisher_daily_rows: publisherDailyRowsScraped,
    };
  } catch (err) {
    log(`Scraper error: ${err.message}`);
    if (browser) await browser.close().catch(() => {});
    try {
      fs.readdirSync(downloadDir).forEach((f) => fs.unlinkSync(path.join(downloadDir, f)));
      fs.rmdirSync(downloadDir);
    } catch (_) {}
    return { success: false, count: 0, error: err.message };
  }
}
