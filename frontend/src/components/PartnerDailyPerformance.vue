<template>
  <div>
    <div class="page-title-card">
      <h4 class="page-title">Partner Daily Performance</h4>
      <p class="page-subtitle">Performance by publisher/partner for merchant {{ selectedMerchantName || 'all' }}</p>
    </div>

    <!-- Filters -->
    <div class="affilient-card" style="padding:1rem 1.25rem; margin-bottom:1rem;">
      <div class="row g-3 mb-3">
        <div class="col-md-3">
          <label class="form-label fw-semibold" style="font-size:0.85rem;">From</label>
          <input v-model="startDate" type="date" class="form-control" />
        </div>
        <div class="col-md-3">
          <label class="form-label fw-semibold" style="font-size:0.85rem;">To</label>
          <input v-model="endDate" type="date" class="form-control" />
        </div>
        <div class="col-md-3">
          <label class="form-label fw-semibold" style="font-size:0.85rem;">Merchant</label>
          <select v-model="selectedMerchantId" class="form-select">
            <option value="">All Merchants</option>
            <option v-for="m in merchants" :key="m.id" :value="m.id">{{ m.name }}</option>
          </select>
        </div>
        <div class="col-md-3">
          <label class="form-label fw-semibold" style="font-size:0.85rem;">Aggregation</label>
          <select v-model="aggregation" class="form-select">
            <option value="daily">Daily</option>
            <option value="weekly">Weekly</option>
            <option value="monthly">Monthly</option>
          </select>
        </div>
      </div>
      <div v-if="showLargeRangeChoice" class="mb-3 p-2 rounded" style="background:var(--accent-green-light);">
        <label class="form-label fw-semibold" style="font-size:0.85rem;">Large date range: group by</label>
        <select v-model="largeRangeGroupBy" class="form-select form-select-sm" style="max-width:200px;">
          <option value="week">By week</option>
          <option value="month">By month</option>
        </select>
      </div>
      <div class="d-flex gap-2">
        <button class="btn btn-update" @click="load">Update</button>
        <button class="btn btn-export" @click="exportCSV">Export</button>
      </div>
    </div>

    <!-- Table -->
    <div class="table-card">
      <div class="table-card-header">
        <h5>Performance by Partner {{ aggregation !== 'daily' ? '(' + aggregation + ' aggregated)' : '' }}</h5>
      </div>
      <div class="table-card-body">
        <div class="summary-bar">
          <div class="summary-title">
            Period: {{ startDate }} to {{ endDate }} ({{ dailyData.length }} records)
          </div>
          <div class="summary-details">
            Clicks: {{ totals.clicks }} Actions: {{ totals.actions }} Revenue: {{ formatCurrency(totals.revenue) }} Commission: {{ formatCurrency(totals.commission) }}
          </div>
        </div>
        <div style="overflow-x:auto;">
          <table class="affilient-table">
            <thead>
              <tr>
                <th><input type="checkbox" /></th>
                <th>{{ aggregation === 'daily' ? 'Date' : (aggregation === 'weekly' ? 'Week' : 'Month') }}</th>
                <th>Partner</th>
                <th>Network</th>
                <th>Clicks</th>
                <th>Actions</th>
                <th>Revenue</th>
                <th>Commission</th>
                <th>Conv. Rate</th>
                <th>EPC</th>
              </tr>
            </thead>
            <tbody>
              <tr class="totals-row">
                <td></td>
                <td>TOTALS</td>
                <td>ALL</td>
                <td>ALL</td>
                <td>{{ totals.clicks }}</td>
                <td>{{ totals.actions }}</td>
                <td>{{ formatCurrency(totals.revenue) }}</td>
                <td>{{ formatCurrency(totals.commission) }}</td>
                <td>{{ totals.clicks ? ((totals.actions / totals.clicks) * 100).toFixed(1) + '%' : '0%' }}</td>
                <td>{{ totals.actions ? formatCurrency(totals.revenue / totals.actions) : formatCurrency(0) }}</td>
              </tr>
              <tr v-for="(row, i) in dailyData" :key="i">
                <td><input type="checkbox" /></td>
                <td>{{ row.periodLabel }}</td>
                <td>
                  <span class="fw-semibold">{{ row.publisher }}</span>
                  <span v-if="row.publisher_id" style="font-size:0.75rem; color:var(--text-muted);"> ({{ row.publisher_id }})</span>
                </td>
                <td>
                  <span class="badge-network" :class="'badge-' + (row.network || '').toLowerCase()">
                    {{ (row.network || '').toUpperCase() }}
                  </span>
                </td>
                <td>{{ row.clicks }}</td>
                <td>{{ row.actions }}</td>
                <td>{{ formatRowMoney(row.revenue, row.network) }}</td>
                <td>{{ formatRowMoney(row.commission, row.network) }}</td>
                <td>{{ row.clicks ? ((row.actions / row.clicks) * 100).toFixed(1) + '%' : '—' }}</td>
                <td>{{ row.actions ? formatRowMoney(row.revenue / row.actions, row.network) : formatRowMoney(0, row.network) }}</td>
              </tr>
              <tr v-if="dailyData.length === 0">
                <td colspan="10" class="text-muted text-center py-3">No data. Run Sync first (Dashboard → Fetch Data), then select a merchant and date range.</td>
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
import { defaultCurrencyForNetwork, formatMoneyAmount } from '../utils/currencyFormat'

const props = defineProps({
  merchants: { type: Array, default: () => [] },
  presetMerchantId: { type: String, default: '' },
})

const publisherDaily = ref([])
const selectedMerchantId = ref('')

watch(() => props.presetMerchantId, (id) => {
  selectedMerchantId.value = id || ''
  load()
}, { immediate: true })
const startDate = ref(new Date(Date.now() - 30 * 864e5).toISOString().slice(0, 10))
const endDate = ref(new Date().toISOString().slice(0, 10))
const aggregation = ref('daily')
const largeRangeGroupBy = ref('week') // when range > ~31 days: by week or by month

const selectedMerchantName = computed(() => {
  if (!selectedMerchantId.value) return ''
  const m = props.merchants.find(m => String(m.id) === String(selectedMerchantId.value))
  return m ? m.name : ''
})

const daysInRange = computed(() => {
  const start = new Date(startDate.value)
  const end = new Date(endDate.value)
  return Math.ceil((end - start) / 864e5) + 1
})

const showLargeRangeChoice = computed(() => {
  return daysInRange.value > 31 && (aggregation.value === 'weekly' || aggregation.value === 'monthly')
})

function getPeriodKey(dateStr, agg) {
  const d = new Date(dateStr + 'T12:00:00Z')
  if (agg === 'monthly') return d.getUTCFullYear() + '-' + String(d.getUTCMonth() + 1).padStart(2, '0')
  if (agg === 'weekly') {
    const jan1 = new Date(d.getUTCFullYear(), 0, 1)
    const weekNo = Math.ceil((((d - jan1) / 864e5) + jan1.getUTCDay() + 1) / 7)
    return d.getUTCFullYear() + '-W' + String(weekNo).padStart(2, '0')
  }
  return dateStr
}

function getPeriodLabel(periodKey, agg) {
  if (agg === 'monthly') {
    const [y, m] = periodKey.split('-')
    const names = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']
    return names[parseInt(m, 10) - 1] + ' ' + y
  }
  if (agg === 'weekly') return periodKey
  return periodKey
}

const dailyData = computed(() => {
  const agg = aggregation.value
  const useLarge = showLargeRangeChoice.value
  const groupBy = largeRangeGroupBy.value
  const raw = (publisherDaily.value || []).map(t => ({
    date: (t.date || '').slice(0, 10),
    publisher: t.publisher_name || t.publisher_id || 'Unknown',
    publisher_id: t.publisher_id || '',
    network: t.network || '',
    clicks: Number(t.clicks || 0),
    actions: Number(t.actions || 0),
    revenue: Number(t.revenue || 0),
    commission: Number(t.commission || 0),
  })).filter(r => r.date)
  if (agg === 'daily') {
    return raw
      .map(r => ({ ...r, periodLabel: r.date }))
      .sort((a, b) => b.date.localeCompare(a.date))
  }
  const effectiveAgg = (useLarge && groupBy === 'month') ? 'monthly' : (useLarge && groupBy === 'week') ? 'weekly' : agg
  const map = {}
  raw.forEach(r => {
    const periodKey = getPeriodKey(r.date, effectiveAgg)
    const rowKey = periodKey + '|' + (r.publisher_id || r.publisher) + '|' + (r.network || '')
    if (!map[rowKey]) {
      map[rowKey] = {
        periodLabel: getPeriodLabel(periodKey, effectiveAgg),
        periodKey,
        publisher: r.publisher,
        publisher_id: r.publisher_id,
        network: r.network,
        clicks: 0,
        actions: 0,
        revenue: 0,
        commission: 0,
      }
    }
    map[rowKey].clicks += r.clicks
    map[rowKey].actions += r.actions
    map[rowKey].revenue += r.revenue
    map[rowKey].commission += r.commission
  })
  return Object.values(map).sort((a, b) => b.periodKey.localeCompare(a.periodKey) || a.publisher.localeCompare(b.publisher))
})

const totals = computed(() => {
  let clicks = 0, actions = 0, revenue = 0, commission = 0
  dailyData.value.forEach(r => {
    clicks += r.clicks; actions += r.actions; revenue += r.revenue; commission += r.commission
  })
  return { clicks, actions, revenue, commission }
})

const tableCurrency = computed(() => {
  if (selectedMerchantId.value) {
    const m = props.merchants.find(x => String(x.id) === String(selectedMerchantId.value))
    if (m) return defaultCurrencyForNetwork(m.network)
  }
  const nets = new Set(dailyData.value.map(r => (r.network || '').toLowerCase()).filter(Boolean))
  if (nets.size === 1) return defaultCurrencyForNetwork([...nets][0])
  return 'USD'
})

function formatCurrency(v) {
  return formatMoneyAmount(v, tableCurrency.value)
}

function formatRowMoney(v, network) {
  return formatMoneyAmount(v, defaultCurrencyForNetwork(network))
}

function exportCSV() {
  const periodCol = aggregation.value === 'daily' ? 'Date' : (aggregation.value === 'weekly' ? 'Week' : 'Month')
  const rows = [[periodCol, 'Partner', 'Partner ID', 'Network', 'Clicks', 'Actions', 'Revenue', 'Commission', 'Conv. Rate', 'EPC']]
  dailyData.value.forEach(r => {
    const cr = r.clicks ? ((r.actions / r.clicks) * 100).toFixed(1) + '%' : '0%'
    const epc = r.actions ? (r.revenue / r.actions).toFixed(4) : '0'
    rows.push([r.periodLabel || r.date, r.publisher, r.publisher_id || '', r.network, r.clicks, r.actions, r.revenue, r.commission, cr, epc])
  })
  const csv = rows.map(row => row.join(',')).join('\n')
  const blob = new Blob([csv], { type: 'text/csv' })
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = 'partner_daily_performance.csv'; a.click()
}

async function load() {
  try {
    const params = { start_date: startDate.value, end_date: endDate.value }
    if (selectedMerchantId.value) params.merchant_id = selectedMerchantId.value
    const r = await api.performancePublishersDaily(params)
    let rows = r.success ? r.data || [] : []
    if (!rows.length && selectedMerchantId.value) {
      const dr = await api.performanceDaily(params).catch(() => ({ success: false }))
      if (dr.success && Array.isArray(dr.data) && dr.data.length) {
        rows = dr.data.map((row) => ({
          date: row.date,
          network: row.network || '',
          publisher_id: '',
          publisher_name: '— Σύνολο merchant (ανά ημέρα, χωρίς per-publisher στο DB)',
          clicks: Number(row.clicks || 0),
          impressions: Number(row.impressions || 0),
          actions: Number(row.transactions || 0),
          revenue: Number(row.revenue || 0),
          commission: Number(row.commission || 0),
        }))
      }
    }
    publisherDaily.value = rows
  } catch (_) {
    publisherDaily.value = []
  }
}

onMounted(load)

</script>
