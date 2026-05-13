<template>
  <div>
    <div class="page-title-card">
      <h4 class="page-title">CJ Brand Manager</h4>
      <p class="page-subtitle">Manage CJ network merchants and brands</p>
    </div>

    <!-- Daily cron time (UTC) -->
    <div class="affilient-card" style="padding:1rem 1.25rem; margin-bottom:1rem;">
      <h6 class="mb-2">Daily cron (UTC)</h6>
      <p class="text-muted mb-2" style="font-size:0.8rem;">Sync and fetch run once per day at this time.</p>
      <div class="row g-2 align-items-end">
        <div class="col-md-3">
          <label class="form-label" style="font-size:0.8rem;">Time (HH:MM)</label>
          <input v-model="scheduleTimeUtc" type="text" class="form-control form-control-sm" placeholder="02:00" maxlength="5" />
        </div>
        <div class="col-md-3">
          <button class="btn btn-update btn-sm" :disabled="savingSchedule" @click="saveSchedule">{{ savingSchedule ? 'Saving...' : 'Save' }}</button>
        </div>
      </div>
    </div>

    <!-- Feed type (Google Feed / Shopify) -->
    <div class="affilient-card" style="padding:1rem 1.25rem; margin-bottom:1rem;">
      <h6 class="mb-2">Feed type</h6>
      <div class="row g-3 align-items-end">
        <div class="col-md-4">
          <label class="form-label" style="font-size:0.8rem;">Source</label>
          <select v-model="feedType" class="form-select form-select-sm">
            <option value="google">Google Feed</option>
            <option value="shopify">Shopify (store JSON feed)</option>
          </select>
        </div>
        <div v-if="feedType === 'shopify'" class="col-md-6">
          <label class="form-label" style="font-size:0.8rem;">Store URL (JSON endpoint)</label>
          <input v-model="storeUrl" class="form-control form-control-sm" placeholder="https://.../products.json" />
        </div>
      </div>
    </div>

    <!-- Stats -->
    <div class="row g-3 mb-3">
      <div class="col-md-4">
        <div class="stat-card">
          <div>
            <div class="stat-label">CJ Merchants</div>
            <div class="stat-value">{{ cjMerchants.length }}</div>
          </div>
          <div class="stat-icon">&#128203;</div>
        </div>
      </div>
      <div class="col-md-4">
        <div class="stat-card green">
          <div>
            <div class="stat-label">Active</div>
            <div class="stat-value">{{ cjMerchants.length }}</div>
          </div>
          <div class="stat-icon">&#9989;</div>
        </div>
      </div>
      <div class="col-md-4">
        <div class="stat-card blue">
          <div>
            <div class="stat-label">Network</div>
            <div class="stat-value">CJ</div>
          </div>
          <div class="stat-icon">&#127760;</div>
        </div>
      </div>
    </div>

    <!-- Merchants: Fetch affiliates (API) + Scrape performance (Playwright reports) -->
    <div class="table-card">
      <div class="table-card-header">
        <h5>CJ Merchants</h5>
        <p class="text-muted mb-0" style="font-size:0.8rem; font-weight:normal;">
          <strong>Fetch affiliates</strong> — λίστα publishers (Publisher Lookup) + ημερήσια metrics από
          <strong>CJ Commission API</strong> (clicks/impressions όταν είναι commission events, transactions/revenue/commission από sales/leads).
          <strong>Scrape performance</strong> — CSV από CJ Insights (ίδια στήλη με το UI: Clicks, Impressions, Transactions, Revenue, Commission).
        </p>
      </div>
      <div v-if="showFetchProgressBanner" class="cj-fetch-progress-banner">
        <div class="cj-fetch-progress-top">
          <span class="cj-fetch-progress-title">
            <template v-if="fetchingPublishers != null">
              Fetch affiliates<span v-if="fetchProgressMerchantName"> — {{ fetchProgressMerchantName }}</span>…
            </template>
            <template v-else>Ολοκληρώθηκε</template>
          </span>
          <span class="cj-fetch-progress-pct">{{ fetchProgressPercentRounded }}%</span>
        </div>
        <div class="cj-fetch-progress-track" role="progressbar" :aria-valuenow="fetchProgressPercentRounded" aria-valuemin="0" aria-valuemax="100">
          <div class="cj-fetch-progress-fill" :style="{ width: fetchProgressPercent + '%' }" />
        </div>
        <p class="cj-fetch-progress-hint">
          Η αίτηση τρέχει στον server (CJ ανά χώρα / σελίδες). Η μπάρα γεμίζει σταδιακά· στο 100% έχει ολοκληρωθεί η απάντηση.
        </p>
      </div>
      <div class="table-card-body">
        <table class="affilient-table">
          <thead>
            <tr>
              <th>Name</th>
              <th>Network</th>
              <th>Timezone</th>
              <th>Affiliates</th>
              <th>Perf. days</th>
              <th>Status</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="m in cjMerchants" :key="m.id">
              <td class="fw-semibold">{{ m.name }}</td>
              <td><span class="badge-network badge-cj">CJ</span></td>
              <td>{{ m.timezone || 'UTC' }}</td>
              <td>
                <span
                  class="cj-count-link"
                  role="button"
                  tabindex="0"
                  :title="'View affiliates list'"
                  @click="viewPublishers(m.id)"
                  @keydown.enter.prevent="viewPublishers(m.id)"
                >
                  {{ publisherCounts[m.id] ?? '—' }}
                </span>
              </td>
              <td>{{ performanceDailyCounts[m.id] ?? '—' }}</td>
              <td><span class="badge-active">ACTIVE</span></td>
              <td class="cj-actions-cell">
                <button
                  class="btn btn-sm btn-outline-primary me-1"
                  :disabled="fetchingPublishers === m.id || scrapingPerformance === m.id"
                  @click="fetchPublishers(m.id)"
                >
                  {{ fetchingPublishers === m.id ? 'Fetching...' : 'Fetch affiliates' }}
                </button>
                <button
                  class="btn btn-sm btn-outline-secondary"
                  :disabled="scrapingPerformance === m.id || fetchingPublishers === m.id"
                  @click="scrapePerformance(m.id)"
                >
                  {{ scrapingPerformance === m.id ? 'Scraping...' : 'Scrape performance' }}
                </button>
              </td>
            </tr>
            <tr v-if="cjMerchants.length === 0">
              <td colspan="7" class="text-muted text-center py-3">
                No CJ merchants. Add merchants with network "CJ" in the Merchants section.
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>

    <!-- Affiliates list -->
    <div v-if="selectedMerchantForPublishers" class="table-card" style="margin-top:1rem;">
      <div class="table-card-header">
        <h5>Affiliates list — {{ selectedMerchantName }}</h5>
        <p class="text-muted mb-0 cj-affiliates-subtitle">
          <strong>Clicks … Commission</strong> = άθροισμα <strong>30 ημερών</strong> από
          <code>performance_publisher_daily</code> (ταιριάζει <em>Publisher CID</em> ή <em>Website ID</em> μετά από νέο
          <strong>Fetch affiliates</strong>). Αν μένουν 0: δεν υπάρχουν commissions στο διάστημα, ή τρέξε
          <strong>Scrape performance</strong> για πλήρη CJ Insights.
        </p>
      </div>
      <div class="table-card-body">
        <div class="summary-bar">
          <div class="summary-title">{{ filteredPublisherList.length }} / {{ publisherList.length }} affiliates</div>
          <div class="summary-details">
            <input
              v-model="publisherSearch"
              class="form-control form-control-sm"
              style="max-width:260px; display:inline-block; margin-right:0.5rem;"
              placeholder="Search name / id / domain"
            />
            <button class="btn btn-sm btn-outline-secondary" @click="selectedMerchantForPublishers = null">Close</button>
          </div>
        </div>
        <div class="cj-affiliates-table-wrap">
          <table class="affilient-table cj-affiliates-table">
            <thead>
              <tr>
                <th class="cj-col-pub">Publisher</th>
                <th class="cj-col-id" title="Publisher company ID (CJ)">ID</th>
                <th class="cj-col-domain">Site</th>
                <th class="cj-metric-head" title="Clicks (30 d.)">Clk</th>
                <th class="cj-metric-head" title="Impressions (30 d.)">Imp</th>
                <th class="cj-metric-head" title="Transactions (30 d.)">Txn</th>
                <th class="cj-metric-head" title="Revenue (30 d.)">Rev</th>
                <th class="cj-metric-head" title="Commission (30 d.)">Com</th>
                <th class="cj-col-actions"></th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="p in filteredPublisherList" :key="String(p.id || '') + '|' + (p.publisher_id || '')">
                <td class="fw-semibold cj-cell-pub" :title="p.name || ''">{{ p.name || p.publisher_id || '—' }}</td>
                <td class="cj-mono cj-cell-id">{{ p.publisher_id || '—' }}</td>
                <td class="cj-cell-domain">
                  <template v-if="domainHref(p.domain)">
                    <a
                      :href="domainHref(p.domain)"
                      target="_blank"
                      rel="noopener noreferrer"
                      class="cj-domain-link"
                      :title="p.domain"
                    >{{ domainLabel(p.domain) }}</a>
                  </template>
                  <template v-else>{{ p.domain || '—' }}</template>
                </td>
                <td class="cj-metric">{{ fmtInt(p.clicks) }}</td>
                <td class="cj-metric">{{ fmtInt(p.impressions) }}</td>
                <td class="cj-metric">{{ fmtInt(p.transactions) }}</td>
                <td class="cj-metric cj-money">{{ fmtUsd(p.revenue) }}</td>
                <td class="cj-metric cj-money">{{ fmtUsd(p.commission) }}</td>
                <td class="cj-col-actions">
                  <div class="cj-action-btns">
                    <button type="button" class="btn btn-sm btn-outline-secondary" title="Copy publisher ID" @click="copyText(p.publisher_id)">ID</button>
                    <button type="button" class="btn btn-sm btn-outline-secondary" title="Copy URL" @click="copyText(p.domain)">URL</button>
                  </div>
                </td>
              </tr>
              <tr v-if="filteredPublisherList.length === 0">
                <td colspan="9" class="text-muted text-center py-3">No matching affiliates.</td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup>
import { computed, ref, onMounted, onUnmounted } from 'vue'
import { api } from '../api'

const props = defineProps({ merchants: { type: Array, default: () => [] } })
const cjMerchants = computed(() => (props.merchants || []).filter(m => (m.network || '').toLowerCase() === 'cj'))

const feedType = ref('google')
const storeUrl = ref('')
const scheduleTimeUtc = ref('02:00')
const savingSchedule = ref(false)
const publisherCounts = ref({})
const performanceDailyCounts = ref({})
const fetchingPublishers = ref(null)
/** 0–100: αυξάνεται σταδιακά κατά το request· 100 όταν ολοκληρωθεί (το HTTP δεν στέλνει πραγματικό %). */
const fetchProgressPercent = ref(0)
const fetchProgressMerchantName = ref('')
const fetchProgressPercentRounded = computed(() => Math.min(100, Math.round(fetchProgressPercent.value)))
const showFetchProgressBanner = computed(
  () => fetchingPublishers.value != null || fetchProgressPercent.value > 0
)
let fetchProgressIntervalId = null
let fetchProgressHideTimeoutId = null

function clearFetchProgressInterval() {
  if (fetchProgressIntervalId != null) {
    clearInterval(fetchProgressIntervalId)
    fetchProgressIntervalId = null
  }
}

function clearFetchProgressHideTimeout() {
  if (fetchProgressHideTimeoutId != null) {
    clearTimeout(fetchProgressHideTimeoutId)
    fetchProgressHideTimeoutId = null
  }
}

function startFetchProgressUi(merchantId) {
  clearFetchProgressInterval()
  clearFetchProgressHideTimeout()
  fetchProgressPercent.value = 3
  const m = cjMerchants.value.find((x) => String(x.id) === String(merchantId))
  fetchProgressMerchantName.value = m ? m.name : ''
  fetchProgressIntervalId = setInterval(() => {
    const p = fetchProgressPercent.value
    if (p >= 88) return
    const step = 1.2 + Math.random() * 2.2
    fetchProgressPercent.value = Math.min(88, p + step)
  }, 400)
}

function completeFetchProgressUi() {
  clearFetchProgressInterval()
  fetchProgressPercent.value = 100
  clearFetchProgressHideTimeout()
  fetchProgressHideTimeoutId = setTimeout(() => {
    fetchProgressHideTimeoutId = null
    fetchProgressPercent.value = 0
    fetchProgressMerchantName.value = ''
  }, 750)
}

const scrapingPerformance = ref(null)
const loadingPublisherList = ref(null)
const selectedMerchantForPublishers = ref(null)
const publisherList = ref([])
const publisherSearch = ref('')

const selectedMerchantName = computed(() => {
  if (!selectedMerchantForPublishers.value) return ''
  const m = cjMerchants.value.find(x => String(x.id) === String(selectedMerchantForPublishers.value))
  return m ? m.name : String(selectedMerchantForPublishers.value)
})

const filteredPublisherList = computed(() => {
  const q = (publisherSearch.value || '').trim().toLowerCase()
  const list = Array.isArray(publisherList.value) ? publisherList.value : []
  if (!q) return list
  return list.filter(p => {
    const name = String(p?.name || '').toLowerCase()
    const id = String(p?.publisher_id || '').toLowerCase()
    const domain = String(p?.domain || '').toLowerCase()
    return name.includes(q) || id.includes(q) || domain.includes(q)
  })
})

function fmtInt(v) {
  const n = Number(v)
  if (!Number.isFinite(n)) return '—'
  return String(Math.round(n))
}

function fmtUsd(v) {
  const n = Number(v)
  if (!Number.isFinite(n)) return '—'
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 2 }).format(n)
}

function domainHref(raw) {
  const s = String(raw || '').trim()
  if (!s) return ''
  const lower = s.toLowerCase()
  if (lower.includes('nowebsite') || lower.includes('no website')) return ''
  if (lower.startsWith('mailto:')) return s
  if (/^https?:\/\//i.test(s)) return s
  if (/^\/\//.test(s)) return `https:${s}`
  if (/^[a-z0-9.-]+\.[a-z]{2,}(\/|$)/i.test(s)) return `https://${s.replace(/^\/+/, '')}`
  return ''
}

function domainLabel(raw) {
  const s = String(raw || '').trim()
  if (s.length <= 36) return s
  return s.slice(0, 18) + '…' + s.slice(-14)
}

async function copyText(t) {
  const s = String(t || '').trim()
  if (!s) return
  try {
    await navigator.clipboard.writeText(s)
  } catch (_) {
    // fallback
    const el = document.createElement('textarea')
    el.value = s
    document.body.appendChild(el)
    el.select()
    document.execCommand('copy')
    document.body.removeChild(el)
  }
}

async function loadSettings() {
  try {
    const r = await api.settings()
    if (r.success && r.data && r.data.schedule_time_utc) scheduleTimeUtc.value = r.data.schedule_time_utc
  } catch (_) {}
}

async function saveSchedule() {
  savingSchedule.value = true
  try {
    await api.updateSettings({ schedule_time_utc: scheduleTimeUtc.value })
  } finally {
    savingSchedule.value = false
  }
}

async function loadPublisherCounts() {
  const next = { ...publisherCounts.value }
  for (const m of cjMerchants.value) {
    try {
      const r = await api.merchantPublishers(m.id)
      next[m.id] = (r.success && Array.isArray(r.data)) ? r.data.length : 0
    } catch (_) {
      next[m.id] = '—'
    }
  }
  publisherCounts.value = next
}

async function fetchPublishers(merchantId) {
  fetchingPublishers.value = merchantId
  startFetchProgressUi(merchantId)
  try {
    const r = await api.fetchMerchantPublishers(merchantId)
    if (r.success && r.data && r.data.count != null) {
      publisherCounts.value[merchantId] = r.data.count
    }
    await loadPublisherCounts()
    await loadPerformanceDailyCounts()
    // Auto-open list after fetch so results are visible.
    await viewPublishers(merchantId)
  } catch (_) {}
  finally {
    completeFetchProgressUi()
    fetchingPublishers.value = null
  }
}

async function viewPublishers(merchantId) {
  loadingPublisherList.value = merchantId
  selectedMerchantForPublishers.value = merchantId
  try {
    const r = await api.merchantPublishers(merchantId)
    publisherList.value = (r.success && Array.isArray(r.data)) ? r.data : []
  } catch (_) {
    publisherList.value = []
  } finally {
    loadingPublisherList.value = null
  }
}

async function loadPerformanceDailyCounts() {
  const end = new Date()
  const start = new Date()
  start.setDate(start.getDate() - 90)
  const start_date = start.toISOString().slice(0, 10)
  const end_date = end.toISOString().slice(0, 10)
  const next = { ...performanceDailyCounts.value }
  for (const m of cjMerchants.value) {
    try {
      const r = await api.performanceDaily({
        merchant_id: m.id,
        network: 'cj',
        start_date,
        end_date,
      })
      next[m.id] = (r.success && Array.isArray(r.data)) ? r.data.length : 0
    } catch (_) {
      next[m.id] = '—'
    }
  }
  performanceDailyCounts.value = next
}

/** Playwright: login → Performance report → CSV → performance_daily (ίδια ιδέα με Python scrape) */
async function scrapePerformance(merchantId) {
  scrapingPerformance.value = merchantId
  try {
    const r = await api.scrapeMerchantPerformance(merchantId)
    if (r.success && r.data) {
      const days = r.data.daily_days != null ? r.data.daily_days : r.data.count
      if (days != null) {
        performanceDailyCounts.value = { ...performanceDailyCounts.value, [merchantId]: days }
      }
    }
    await loadPerformanceDailyCounts()
    await loadPublisherCounts()
    if (String(selectedMerchantForPublishers.value) === String(merchantId)) {
      await viewPublishers(merchantId)
    }
  } catch (_) {}
  finally {
    scrapingPerformance.value = null
  }
}

onMounted(() => {
  loadSettings()
  loadPublisherCounts()
  loadPerformanceDailyCounts()
})

onUnmounted(() => {
  clearFetchProgressInterval()
  clearFetchProgressHideTimeout()
  fetchProgressPercent.value = 0
  fetchProgressMerchantName.value = ''
})
</script>

<style scoped>
.cj-affiliates-table-wrap {
  overflow-x: visible;
  overflow-y: auto;
  max-height: min(70vh, 640px);
  border: 1px solid rgba(0, 0, 0, 0.06);
  border-radius: 12px;
}

.cj-affiliates-table {
  width: 100%;
  table-layout: fixed;
  font-size: 0.78rem;
}

.cj-affiliates-table thead th {
  position: sticky;
  top: 0;
  z-index: 2;
  background: #fff;
}

.cj-affiliates-table tbody tr:nth-child(odd) {
  background: rgba(0, 0, 0, 0.02);
}

.cj-affiliates-table td,
.cj-affiliates-table th {
  padding: 6px 4px;
  vertical-align: middle;
}

.cj-col-pub {
  width: 22%;
}

.cj-col-id {
  width: 9%;
}

.cj-col-domain {
  width: 20%;
}

.cj-col-actions {
  width: 52px;
  padding-left: 2px !important;
  padding-right: 2px !important;
}

.cj-cell-pub {
  word-break: break-word;
  white-space: normal;
  line-height: 1.25;
  hyphens: auto;
}

.cj-cell-id {
  word-break: break-all;
  font-size: 0.72rem;
}

.cj-cell-domain {
  word-break: break-all;
  white-space: normal;
  line-height: 1.25;
}

.cj-domain-link {
  color: var(--bs-primary, #0d6efd);
  text-decoration: underline;
  text-underline-offset: 2px;
}

.cj-domain-link:hover {
  opacity: 0.88;
}

.cj-action-btns {
  display: flex;
  flex-direction: column;
  gap: 2px;
  align-items: stretch;
}

.cj-action-btns .btn {
  padding: 0.12rem 0.2rem;
  font-size: 0.65rem;
  line-height: 1.2;
}

.cj-mono {
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace;
  font-size: 0.88rem;
}

.cj-count-link {
  cursor: pointer;
  color: var(--bs-primary, #0d6efd);
  text-decoration: underline;
  text-underline-offset: 2px;
}

.cj-count-link:hover {
  opacity: 0.85;
}

.cj-actions-cell {
  white-space: nowrap;
}

.cj-affiliates-subtitle {
  font-size: 0.78rem;
  line-height: 1.4;
  margin-top: 0.35rem;
  max-width: 920px;
}

.cj-metric-head,
.cj-metric {
  text-align: right;
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
}

.cj-metric-head {
  font-size: 0.72rem;
  text-transform: uppercase;
  letter-spacing: 0.02em;
  color: rgba(0, 0, 0, 0.45);
}

.cj-money {
  font-size: 0.85rem;
}

.cj-fetch-progress-banner {
  padding: 0.85rem 1.25rem 1rem;
  border-bottom: 1px solid rgba(0, 0, 0, 0.06);
  background: linear-gradient(180deg, rgba(13, 110, 253, 0.06) 0%, transparent 100%);
}

.cj-fetch-progress-top {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.75rem;
  margin-bottom: 0.45rem;
}

.cj-fetch-progress-title {
  font-size: 0.875rem;
  font-weight: 600;
  color: rgba(0, 0, 0, 0.78);
}

.cj-fetch-progress-pct {
  font-size: 0.8rem;
  font-weight: 700;
  font-variant-numeric: tabular-nums;
  color: var(--bs-primary, #0d6efd);
}

.cj-fetch-progress-track {
  height: 10px;
  border-radius: 999px;
  background: rgba(0, 0, 0, 0.08);
  overflow: hidden;
}

.cj-fetch-progress-fill {
  height: 100%;
  border-radius: 999px;
  background: linear-gradient(90deg, var(--bs-primary, #0d6efd), #4d94ff);
  transition: width 0.35s ease-out;
  box-shadow: 0 0 12px rgba(13, 110, 253, 0.35);
}

.cj-fetch-progress-hint {
  margin: 0.5rem 0 0;
  font-size: 0.72rem;
  line-height: 1.35;
  color: rgba(0, 0, 0, 0.5);
}
</style>
