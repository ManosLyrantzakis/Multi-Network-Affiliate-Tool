<template>
  <div>
    <!-- Header with filters -->
    <div class="perf-header">
      <div class="title-section">
        <h4>Performance Dashboard</h4>
        <p>Monitor your affiliate marketing performance</p>
      </div>
      <div class="perf-filters">
        <div class="perf-filter-group">
          <label>Date Preset</label>
          <select v-model="datePreset" class="form-select" @change="applyPreset">
            <option value="custom">Custom</option>
            <option value="7d">Last 7 Days</option>
            <option value="30d">Last 30 Days</option>
            <option value="90d">Last 90 Days</option>
          </select>
        </div>
        <div class="perf-filter-group">
          <label>From</label>
          <input v-model="filters.start_date" type="date" class="form-control" />
        </div>
        <div class="perf-filter-group">
          <label>To</label>
          <input v-model="filters.end_date" type="date" class="form-control" />
        </div>
        <template v-if="comparePeriods">
          <div class="perf-filter-group">
            <label>Period B From</label>
            <input v-model="filters.start_date_b" type="date" class="form-control" />
          </div>
          <div class="perf-filter-group">
            <label>Period B To</label>
            <input v-model="filters.end_date_b" type="date" class="form-control" />
          </div>
        </template>
        <div class="perf-filter-group">
          <label class="d-flex align-items-center gap-1">
            <input type="checkbox" v-model="comparePeriods" class="form-check-input" style="margin:0;" />
            Compare Periods
          </label>
        </div>
        <div class="perf-filter-group">
          <label>Merchant</label>
          <select v-model="filters.merchant_ids" class="form-select" multiple style="min-height:80px;">
            <option v-for="m in merchants" :key="m.id" :value="m.id">
              {{ m.name }} ({{ (m.network || '').toUpperCase() }})
            </option>
          </select>
          <div class="form-text" style="font-size:0.7rem;">Ctrl+click for multiple; consolidated across networks</div>
        </div>
        <div class="perf-filter-group">
          <label>Network</label>
          <select v-model="filters.network" class="form-select">
            <option value="">All Networks</option>
            <option value="awin">AWIN</option>
            <option value="cj">CJ</option>
            <option value="impact">Impact</option>
            <option value="webgains">Webgains</option>
          </select>
        </div>
        <div class="perf-filter-group">
          <label>View</label>
          <select v-model="viewBy" class="form-select">
            <option value="partner">By Partner</option>
            <option value="merchant">By Merchant</option>
          </select>
        </div>
        <div class="perf-filter-group">
          <button class="btn btn-update" @click="load">Update</button>
        </div>
      </div>
    </div>

    <div class="timezone-bar">
      Timezone: US/Pacific - Dates are converted to UTC for queries
    </div>

    <!-- Single period: normal stats -->
    <template v-if="!comparePeriods">
      <div class="row g-2 mb-3">
        <div class="col-md-4">
          <div class="stat-card stat-card-compact">
            <div class="stat-label">Transactions</div>
            <div class="stat-value">{{ stats.total_count ?? 0 }}</div>
          </div>
        </div>
        <div class="col-md-4">
          <div class="stat-card stat-card-compact green">
            <div class="stat-label">Sales</div>
            <div class="stat-value">{{ formatCurrency(stats.total_revenue) }}</div>
          </div>
        </div>
        <div class="col-md-4">
          <div class="stat-card stat-card-compact blue">
            <div class="stat-label">Commission</div>
            <div class="stat-value">{{ formatCurrency(stats.total_commission) }}</div>
          </div>
        </div>
      </div>
      <div class="gap-grid-3 mb-3">
        <div class="period-card period-card-compact">
          <div class="period-label">Impressions</div>
          <div class="period-value">{{ stats.impressions ?? 0 }} <span class="period-sub">({{ filters.start_date }} – {{ filters.end_date }})</span></div>
        </div>
        <div class="period-card period-card-compact">
          <div class="period-label">Revenue</div>
          <div class="period-value">{{ formatCurrency(stats.total_revenue) }}</div>
        </div>
        <div class="period-card period-card-compact">
          <div class="period-label">Commissions</div>
          <div class="period-value">{{ formatCurrency(stats.total_commission) }}</div>
        </div>
      </div>
    </template>

    <!-- Compare mode: 2 big Period cards -->
    <div v-else class="compare-periods-cards mb-4">
      <div class="row g-3">
        <div class="col-md-6">
          <div class="compare-period-card compare-period-1">
            <div class="compare-period-title">Period 1</div>
            <div class="compare-period-dates">{{ filters.start_date }} – {{ filters.end_date }}</div>
            <div class="compare-period-stats">
              <div class="compare-stat">
                <span class="compare-stat-label">Transactions</span>
                <span class="compare-stat-value">{{ totals.actions ?? 0 }}</span>
              </div>
              <div class="compare-stat">
                <span class="compare-stat-label">Impressions</span>
                <span class="compare-stat-value">—</span>
              </div>
              <div class="compare-stat">
                <span class="compare-stat-label">Clicks</span>
                <span class="compare-stat-value">{{ totals.clicks }}</span>
              </div>
              <div class="compare-stat">
                <span class="compare-stat-label">Actions</span>
                <span class="compare-stat-value">{{ totals.actions }}</span>
              </div>
              <div class="compare-stat highlight">
                <span class="compare-stat-label">Revenue</span>
                <span class="compare-stat-value">{{ formatCurrency(totals.revenue) }}</span>
              </div>
              <div class="compare-stat highlight">
                <span class="compare-stat-label">Commission</span>
                <span class="compare-stat-value">{{ formatCurrency(totals.commission) }}</span>
              </div>
            </div>
          </div>
        </div>
        <div class="col-md-6">
          <div class="compare-period-card compare-period-2">
            <div class="compare-period-title">Period 2</div>
            <div class="compare-period-dates">{{ filters.start_date_b }} – {{ filters.end_date_b }}</div>
            <div class="compare-period-stats">
              <div class="compare-stat">
                <span class="compare-stat-label">Transactions</span>
                <span class="compare-stat-value">{{ totals.actionsB ?? 0 }}</span>
              </div>
              <div class="compare-stat">
                <span class="compare-stat-label">Impressions</span>
                <span class="compare-stat-value">—</span>
              </div>
              <div class="compare-stat">
                <span class="compare-stat-label">Clicks</span>
                <span class="compare-stat-value">{{ totals.clicksB }}</span>
              </div>
              <div class="compare-stat">
                <span class="compare-stat-label">Actions</span>
                <span class="compare-stat-value">{{ totals.actionsB }}</span>
              </div>
              <div class="compare-stat highlight">
                <span class="compare-stat-label">Revenue</span>
                <span class="compare-stat-value">{{ formatCurrency(totals.revenueB) }}</span>
              </div>
              <div class="compare-stat highlight">
                <span class="compare-stat-label">Commission</span>
                <span class="compare-stat-value">{{ formatCurrency(totals.commissionB) }}</span>
              </div>
            </div>
          </div>
        </div>
      </div>
      <div class="compare-delta-card">
        <span class="compare-delta-label">Revenue difference (Period 1 − Period 2):</span>
        <span class="compare-delta-value" :class="(totals.revenue || 0) - (totals.revenueB || 0) >= 0 ? 'positive' : 'negative'">
          {{ formatCurrency((totals.revenue || 0) - (totals.revenueB || 0)) }}
        </span>
      </div>
    </div>

    <!-- Programs + Publishers (compact) -->
    <div class="gap-grid-2 mb-3">
      <div class="stat-card stat-card-compact">
        <div>
          <div class="stat-label">Programs</div>
          <div class="stat-value">{{ stats.program_count ?? 0 }}</div>
          <div style="font-size:0.65rem; color: var(--text-muted);">Active campaigns</div>
        </div>
      </div>
      <div class="stat-card stat-card-compact blue">
        <div>
          <div class="stat-label">Publishers</div>
          <div class="stat-value">{{ stats.publisher_count ?? 0 }}</div>
          <div style="font-size:0.65rem; color: var(--text-muted);">Total affiliates</div>
        </div>
      </div>
    </div>

    <!-- Charts -->
    <PerformanceCharts :stats="stats" :transactions="transactions" />

    <!-- Performance by Partner / by Merchant Table -->
    <div class="table-card">
      <div class="table-card-header">
        <h5>Performance {{ viewBy === 'merchant' ? 'by Merchant' : 'by Partner' }}</h5>
        <button class="btn-export" @click="exportCSV">Export</button>
      </div>
      <div class="table-card-body">
        <div class="summary-bar">
          <div class="summary-title">
            <template v-if="!comparePeriods">
              {{ filters.start_date }} – {{ filters.end_date }} ({{ displayData.length }} {{ viewBy === 'merchant' ? 'merchants' : 'partners' }})
            </template>
            <template v-else>
              <strong>Period 1</strong> {{ filters.start_date }} – {{ filters.end_date }} &nbsp;|&nbsp;
              <strong>Period 2</strong> {{ filters.start_date_b }} – {{ filters.end_date_b }}
              &nbsp;({{ displayData.length }} {{ viewBy === 'merchant' ? 'merchants' : 'partners' }})
            </template>
          </div>
          <div class="summary-details" v-if="!comparePeriods">
            Clicks: {{ totals.clicks }} Actions: {{ totals.actions }} Revenue: {{ formatCurrency(totals.revenue) }} Cost: {{ formatCurrency(totals.commission) }}
          </div>
        </div>
        <div style="overflow-x:auto;">
          <table class="affilient-table">
            <thead>
              <tr>
                <th><input type="checkbox" /></th>
                <th>{{ viewBy === 'merchant' ? 'Merchant' : 'Partner' }}</th>
                <th>Network</th>
                <template v-if="!comparePeriods">
                  <th>Clicks</th>
                  <th>Actions</th>
                  <th>Revenue</th>
                  <th>Commission</th>
                  <th>CPC</th>
                </template>
                <template v-else>
                  <th class="compare-th">Period 1 Actions</th>
                  <th class="compare-th">Period 1 Revenue</th>
                  <th class="compare-th">Period 2 Actions</th>
                  <th class="compare-th">Period 2 Revenue</th>
                  <th class="compare-th-delta">Δ Revenue</th>
                </template>
              </tr>
            </thead>
            <tbody>
              <tr class="totals-row">
                <td></td>
                <td>TOTALS</td>
                <td>ALL</td>
                <template v-if="!comparePeriods">
                  <td>{{ totals.clicks }}</td>
                  <td>{{ totals.actions }}</td>
                  <td>{{ formatCurrency(totals.revenue) }}</td>
                  <td>{{ formatCurrency(totals.commission) }}</td>
                  <td>{{ totals.clicks ? formatCurrency(totals.commission / totals.clicks) : formatCurrency(0) }}</td>
                </template>
                <template v-else>
                  <td>{{ totals.actions }}</td>
                  <td>{{ formatCurrency(totals.revenue) }}</td>
                  <td>{{ totals.actionsB }}</td>
                  <td>{{ formatCurrency(totals.revenueB) }}</td>
                  <td :class="(totals.revenue || 0) - (totals.revenueB || 0) >= 0 ? 'text-success' : 'text-danger'">
                    {{ formatCurrency((totals.revenue || 0) - (totals.revenueB || 0)) }}
                  </td>
                </template>
              </tr>
              <tr v-for="p in displayData" :key="(p.merchant_id || p.publisher_id || '') + (p.publisher_name || p.merchant_name || '')">
                <td><input type="checkbox" /></td>
                <td>
                  <span class="fw-semibold">{{ p.publisher_name || p.merchant_name || p.name || 'Unknown' }}</span>
                  <span v-if="(p.publisher_id || p.merchant_id)" class="period-sub"> ({{ p.publisher_id || p.merchant_id }})</span>
                </td>
                <td>
                  <span class="badge-network" :class="'badge-' + (p.network || '').toLowerCase()">
                    {{ (p.network || '').toUpperCase() }}
                  </span>
                </td>
                <template v-if="!comparePeriods">
                  <td>{{ p.clicks || 0 }}</td>
                  <td>{{ p.actions || 0 }}</td>
                  <td>{{ formatRowMoney(p.revenue || p.amount, p.network) }}</td>
                  <td>{{ formatRowMoney(p.commission, p.network) }}</td>
                  <td>{{ p.clicks ? formatRowMoney(p.commission / p.clicks, p.network) : formatRowMoney(0, p.network) }}</td>
                </template>
                <template v-else>
                  <td>{{ p.actions || 0 }}</td>
                  <td>{{ formatRowMoney(p.revenue || p.amount, p.network) }}</td>
                  <td>{{ p.actions_b ?? 0 }}</td>
                  <td>{{ formatRowMoney(p.revenue_b, p.network) }}</td>
                  <td :class="(Number(p.revenue || p.amount) || 0) - (Number(p.revenue_b) || 0) >= 0 ? 'text-success' : 'text-danger'">
                    {{ formatRowMoney((Number(p.revenue || p.amount) || 0) - (Number(p.revenue_b) || 0), p.network) }}
                  </td>
                </template>
              </tr>
            </tbody>
          </table>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, computed, onMounted, watch } from 'vue'
import { api } from '../api'
import PerformanceCharts from './PerformanceCharts.vue'
import { defaultCurrencyForNetwork, formatMoneyAmount } from '../utils/currencyFormat'

const props = defineProps({
  merchants: { type: Array, default: () => [] },
  selectedMerchantId: { type: String, default: '' },
})

const stats = ref({})
const statsB = ref({})
const transactions = ref([])
const transactionsB = ref([])
const partnerData = ref([])
const partnerDataB = ref([])
const merchantData = ref([])
const merchantDataB = ref([])
const datePreset = ref('30d')
const comparePeriods = ref(false)
const viewBy = ref('partner')

const filters = ref({
  start_date: new Date(Date.now() - 30 * 864e5).toISOString().slice(0, 10),
  end_date: new Date().toISOString().slice(0, 10),
  start_date_b: new Date(Date.now() - 60 * 864e5).toISOString().slice(0, 10),
  end_date_b: new Date(Date.now() - 31 * 864e5).toISOString().slice(0, 10),
  merchant_ids: [],
  network: '',
})

watch(() => props.selectedMerchantId, (id) => {
  if (id) filters.value.merchant_ids = [parseInt(id, 10)]
  else filters.value.merchant_ids = []
  load()
}, { immediate: true })

const displayData = computed(() => {
  if (!comparePeriods.value) return viewBy.value === 'merchant' ? merchantData.value : partnerData.value
  const dataA = viewBy.value === 'merchant' ? merchantData.value : partnerData.value
  const dataB = viewBy.value === 'merchant' ? merchantDataB.value : partnerDataB.value
  const keyFn = (p) => (p.publisher_id || p.merchant_id || '') + '|' + (p.publisher_name || p.merchant_name || p.name || 'Unknown') + '|' + (p.network || '')
  const map = new Map()
  dataA.forEach(p => { map.set(keyFn(p), { ...p, _period: 'A' }) })
  dataB.forEach(p => {
    const k = keyFn(p)
    const existing = map.get(k)
    if (existing) {
      Object.assign(existing, { clicks_b: p.clicks, actions_b: p.actions, revenue_b: p.revenue ?? p.amount, commission_b: p.commission })
    } else {
      map.set(k, { ...p, clicks: 0, actions: 0, revenue: 0, commission: 0, clicks_b: p.clicks, actions_b: p.actions, revenue_b: p.revenue ?? p.amount, commission_b: p.commission, _period: 'B' })
    }
  })
  return Array.from(map.values())
})

const totals = computed(() => {
  let clicks = 0, actions = 0, revenue = 0, commission = 0
  let clicksB = 0, actionsB = 0, revenueB = 0, commissionB = 0
  partnerData.value.forEach(p => {
    clicks += Number(p.clicks || 0)
    actions += Number(p.actions || 0)
    revenue += Number(p.revenue || p.amount || 0)
    commission += Number(p.commission || 0)
  })
  partnerDataB.value.forEach(p => {
    clicksB += Number(p.clicks || 0)
    actionsB += Number(p.actions || 0)
    revenueB += Number(p.revenue || p.amount || 0)
    commissionB += Number(p.commission || 0)
  })
  return { clicks, actions, revenue, commission, clicksB, actionsB, revenueB, commissionB }
})

const tableCurrency = computed(() => {
  const net = (filters.value.network || '').toLowerCase()
  if (net) return defaultCurrencyForNetwork(net)
  const mids = filters.value.merchant_ids || []
  if (mids.length === 1) {
    const m = props.merchants.find(x => String(x.id) === String(mids[0]))
    if (m) return defaultCurrencyForNetwork(m.network)
  }
  return 'USD'
})

function formatCurrency(v) {
  return formatMoneyAmount(v, tableCurrency.value)
}

function formatRowMoney(v, network) {
  return formatMoneyAmount(v, defaultCurrencyForNetwork(network))
}

function applyPreset() {
  const now = new Date()
  const days = datePreset.value === '7d' ? 7 : datePreset.value === '90d' ? 90 : 30
  filters.value.start_date = new Date(now.getTime() - days * 864e5).toISOString().slice(0, 10)
  filters.value.end_date = now.toISOString().slice(0, 10)
}

async function loadOne(mids, startDate, endDate) {
  const baseParams = { network: filters.value.network, start_date: startDate, end_date: endDate }
  let allTx = []
  let combinedStats = { total_count: 0, total_revenue: 0, total_commission: 0, total_clicks: 0, program_count: 0, publisher_count: 0, impressions: 0 }
  let combinedPublisherPerf = []
  if (mids.length === 0) {
    const [perfRes, txRes, pubRes] = await Promise.all([
      api.performance(baseParams),
      api.transactions(baseParams).catch(() => ({ success: true, data: [] })),
      api.performancePublishers(baseParams).catch(() => ({ success: true, data: [] })),
    ])
    if (perfRes.success) {
      return {
        stats: perfRes.data || {},
        tx: txRes.success ? (txRes.data || []) : [],
        publisherPerf: pubRes.success ? (pubRes.data || []) : [],
      }
    }
    return { stats: {}, tx: [], publisherPerf: [] }
  }
  const perfPromises = mids.map(mid => api.performance({ ...baseParams, merchant_id: mid }).catch(() => ({ success: false })))
  const txPromises = mids.map(mid => api.transactions({ ...baseParams, merchant_id: mid }).catch(() => ({ success: true, data: [] })))
  const publisherPromises = mids.map(mid => api.performancePublishers({ ...baseParams, merchant_id: mid }).catch(() => ({ success: false, data: [] })))

  const [perfResults, txResults, publisherResults] = await Promise.all([
    Promise.all(perfPromises),
    Promise.all(txPromises),
    Promise.all(publisherPromises),
  ])
  perfResults.forEach(r => {
    if (r.success && r.data) {
      combinedStats.total_count += r.data.total_count || 0
      combinedStats.total_revenue += r.data.total_revenue || 0
      combinedStats.total_commission += r.data.total_commission || 0
      combinedStats.total_clicks += r.data.total_clicks || 0
      combinedStats.program_count += r.data.program_count || 0
      combinedStats.publisher_count = Math.max(combinedStats.publisher_count, r.data.publisher_count || 0)
      combinedStats.impressions += r.data.impressions || 0
    }
  })
  txResults.forEach(r => { if (r.success && r.data) allTx = allTx.concat(r.data) })
  publisherResults.forEach(r => {
    if (r.success && r.data) combinedPublisherPerf = combinedPublisherPerf.concat(r.data)
  })
  // Όταν `performance_publisher_daily` είναι άδειο (π.χ. CJ scrape δεν έγραψε ppd) αλλά υπάρχει `performance_daily`
  if (combinedPublisherPerf.length === 0 && mids.length > 0) {
    for (const mid of mids) {
      const dr = await api
        .performanceDaily({
          merchant_id: String(mid),
          start_date: startDate,
          end_date: endDate,
          limit: 5000,
        })
        .catch(() => ({ success: false }))
      if (!dr.success || !Array.isArray(dr.data) || !dr.data.length) continue
      const m = props.merchants.find((x) => String(x.id) === String(mid))
      const net = String(dr.data[0]?.network || m?.network || '').toLowerCase()
      let clicks = 0
      let actions = 0
      let revenue = 0
      let commission = 0
      dr.data.forEach((row) => {
        clicks += Number(row.clicks || 0)
        actions += Number(row.transactions ?? row.actions ?? 0)
        revenue += Number(row.revenue || 0)
        commission += Number(row.commission || 0)
      })
      combinedPublisherPerf.push({
        network: net,
        publisher_id: '__merchant_daily_total__',
        publisher_name: `${m?.name || 'Merchant'} — σύνολο λογαριασμού (χωρίς γραμμές ανά publisher στο DB)`,
        clicks,
        actions,
        revenue,
        commission,
      })
    }
  }
  if (combinedPublisherPerf.length) {
    combinedStats.total_clicks = combinedPublisherPerf.reduce((s, p) => s + Number(p.clicks || 0), 0)
  }
  return { stats: combinedStats, tx: allTx, publisherPerf: combinedPublisherPerf }
}

async function load() {
  try {
    const mids = Array.isArray(filters.value.merchant_ids) ? filters.value.merchant_ids : (filters.value.merchant_ids ? [filters.value.merchant_ids] : [])
    const { stats: s, tx: allTx, publisherPerf } = await loadOne(mids, filters.value.start_date, filters.value.end_date)
    stats.value = s
    transactions.value = allTx
    buildPartnerDataFromPublishers(publisherPerf || [])
    buildMerchantData(allTx)
    if (comparePeriods.value && filters.value.start_date_b && filters.value.end_date_b) {
      const { stats: sB, tx: allTxB, publisherPerf: publisherPerfB } = await loadOne(mids, filters.value.start_date_b, filters.value.end_date_b)
      statsB.value = sB
      transactionsB.value = allTxB
      const listB = publisherPerfB || []
      const mapB = {}
      listB.forEach(p => {
        const key = (p.publisher_id || '') + '|' + (p.publisher_name || p.publisher_id || 'Unknown') + '|' + (p.network || '')
        if (!mapB[key]) mapB[key] = { publisher_name: p.publisher_name || p.publisher_id || 'Unknown', publisher_id: p.publisher_id || '', network: p.network || '', clicks: 0, actions: 0, revenue: 0, commission: 0 }
        mapB[key].clicks += Number(p.clicks || 0)
        mapB[key].actions += Number(p.actions || 0)
        mapB[key].revenue += Number(p.revenue || 0)
        mapB[key].commission += Number(p.commission || 0)
      })
      partnerDataB.value = Object.values(mapB).sort((a, b) => b.revenue - a.revenue)
      const mapM = {}
      allTxB.forEach(t => {
        const mid = t.merchant_id || ''
        const key = mid + '|' + (t.merchant_name || 'Unknown') + '|' + (t.network || '')
        if (!mapM[key]) mapM[key] = { merchant_id: mid, merchant_name: t.merchant_name || 'Unknown', network: t.network || '', clicks: 0, actions: 0, revenue: 0, commission: 0 }
        mapM[key].actions += 1
        mapM[key].revenue += Number(t.amount || 0)
        mapM[key].commission += Number(t.commission || 0)
      })
      merchantDataB.value = Object.values(mapM).sort((a, b) => b.revenue - a.revenue)
    } else {
      statsB.value = {}
      transactionsB.value = []
      partnerDataB.value = []
      merchantDataB.value = []
    }
  } catch (_) {}
}

function buildPartnerDataFromPublishers(publisherList) {
  const map = {}
  publisherList.forEach(p => {
    const key = (p.publisher_id || '') + '|' + (p.publisher_name || p.publisher_id || 'Unknown') + '|' + (p.network || '')
    if (!map[key]) {
      map[key] = {
        publisher_name: p.publisher_name || p.publisher_id || 'Unknown',
        publisher_id: p.publisher_id || '',
        network: p.network || '',
        clicks: 0, actions: 0, revenue: 0, commission: 0,
      }
    }
    map[key].clicks += Number(p.clicks || 0)
    map[key].actions += Number(p.actions || 0)
    map[key].revenue += Number(p.revenue || 0)
    map[key].commission += Number(p.commission || 0)
  })
  partnerData.value = Object.values(map).sort((a, b) => b.revenue - a.revenue)
}

function buildMerchantData(txList) {
  const map = {}
  txList.forEach(t => {
    const mid = t.merchant_id || ''
    const key = mid + '|' + (t.merchant_name || 'Unknown') + '|' + (t.network || '')
    if (!map[key]) {
      map[key] = {
        merchant_id: mid,
        merchant_name: t.merchant_name || 'Unknown',
        network: t.network || '',
        clicks: 0, actions: 0, revenue: 0, commission: 0,
      }
    }
    map[key].actions += 1
    map[key].revenue += Number(t.amount || 0)
    map[key].commission += Number(t.commission || 0)
  })
  merchantData.value = Object.values(map).sort((a, b) => b.revenue - a.revenue)
}

function exportCSV() {
  const isMerchant = viewBy.value === 'merchant'
  const rows = [[isMerchant ? 'Merchant' : 'Partner', isMerchant ? 'Merchant ID' : 'Partner ID', 'Network', 'Clicks', 'Actions', 'Revenue', 'Commission']]
  displayData.value.forEach(p => {
    const name = p.publisher_name || p.merchant_name || p.name
    const id = p.publisher_id || p.merchant_id || ''
    rows.push([name, id, p.network, p.clicks || 0, p.actions || 0, p.revenue || p.amount || 0, p.commission || 0])
  })
  const csv = rows.map(r => r.join(',')).join('\n')
  const blob = new Blob([csv], { type: 'text/csv' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url; a.download = isMerchant ? 'performance_by_merchant.csv' : 'performance_by_partner.csv'; a.click()
  URL.revokeObjectURL(url)
}

</script>
