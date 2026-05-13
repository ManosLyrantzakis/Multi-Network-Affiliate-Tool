<template>
  <div>
    <div class="page-title-card">
      <h4 class="page-title">Clicks</h4>
      <p class="page-subtitle">Clicks by day — {{ merchantDisplayName ? 'for ' + merchantDisplayName : 'all merchants' }}</p>
    </div>

    <!-- Filters -->
    <div class="affilient-card" style="padding:1rem 1.25rem; margin-bottom:1rem;">
      <div class="row g-2 align-items-end">
        <div class="col-md-2">
          <label class="form-label" style="font-size:0.8rem;">Merchant</label>
          <select v-model="selectedMerchantId" class="form-select form-select-sm">
            <option value="">All Merchants</option>
            <option v-for="m in merchants" :key="m.id" :value="m.id">{{ m.name }}</option>
          </select>
        </div>
        <div class="col-md-2">
          <label class="form-label" style="font-size:0.8rem;">Start Date</label>
          <input v-model="startDate" type="date" class="form-control form-control-sm" />
        </div>
        <div class="col-md-2">
          <label class="form-label" style="font-size:0.8rem;">End Date</label>
          <input v-model="endDate" type="date" class="form-control form-control-sm" />
        </div>
        <div class="col-md-2">
          <label class="form-label" style="font-size:0.8rem;">Network</label>
          <select v-model="network" class="form-select form-select-sm">
            <option value="">All Networks</option>
            <option value="awin">AWIN</option>
            <option value="cj">CJ</option>
            <option value="impact">Impact</option>
            <option value="webgains">Webgains</option>
          </select>
        </div>
        <div class="col-md-2">
          <button class="btn btn-update btn-sm w-100" @click="load">Update</button>
        </div>
      </div>
    </div>

    <!-- Stats -->
    <div class="row g-3 mb-3">
      <div class="col-md-4">
        <div class="stat-card">
          <div>
            <div class="stat-label">Total Clicks</div>
            <div class="stat-value">{{ totalClicks }}</div>
          </div>
          <div class="stat-icon">&#128433;</div>
        </div>
      </div>
      <div class="col-md-4">
        <div class="stat-card green">
          <div>
            <div class="stat-label">Actions / Transactions</div>
            <div class="stat-value">{{ totalActions }}</div>
          </div>
          <div class="stat-icon">&#128101;</div>
        </div>
      </div>
      <div class="col-md-4">
        <div class="stat-card blue">
          <div>
            <div class="stat-label">Revenue</div>
            <div class="stat-value">{{ totalRevenue }}</div>
          </div>
          <div class="stat-icon">&#128176;</div>
        </div>
      </div>
    </div>

    <!-- Table -->
    <div class="table-card">
      <div class="table-card-header">
        <h5>Clicks by day{{ merchantDisplayName ? ' — ' + merchantDisplayName : '' }}</h5>
        <button class="btn-export" @click="exportCSV">Export</button>
      </div>
      <div class="table-card-body">
        <div class="summary-bar">
          <div class="summary-title">Daily performance — {{ clickData.length }} records</div>
        </div>
        <div style="overflow-x:auto;">
          <table class="affilient-table">
            <thead>
              <tr>
                <th>Ημερομηνία</th>
                <th>Merchant</th>
                <th>Network</th>
                <th>Clicks</th>
                <th>Impressions</th>
                <th>Partner</th>
                <th>Transactions</th>
                <th>Revenue</th>
                <th>Commission</th>
                <th>Conv. Rate</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="(row, i) in clickData" :key="i">
                <td>{{ row.date }}</td>
                <td>{{ row.merchant_name || '—' }}</td>
                <td>
                  <span class="badge-network" :class="'badge-' + (row.network || '').toLowerCase()">
                    {{ (row.network || '').toUpperCase() }}
                  </span>
                </td>
                <td>{{ row.clicks }}</td>
                <td>{{ row.impressions ?? '—' }}</td>
                <td>
                  <span class="fw-semibold">{{ row.publisher || '—' }}</span>
                  <span v-if="row.publisher_id" class="period-sub"> ({{ row.publisher_id }})</span>
                </td>
                <td>{{ row.actions }}</td>
                <td>{{ formatRowMoney(row.revenue, row.network) }}</td>
                <td>{{ formatRowMoney(row.commission, row.network) }}</td>
                <td>{{ row.clicks ? ((row.actions / row.clicks) * 100).toFixed(1) + '%' : '—' }}</td>
              </tr>
              <tr v-if="clickData.length === 0">
                <td colspan="10" class="text-muted text-center py-3">No data. Run CJ «Fetch affiliates» / «Scrape performance» or Sync, then select a merchant and date range.</td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, computed, watch, onMounted } from 'vue'
import { api } from '../api'
import { defaultCurrencyForNetwork, formatMoneyAmount } from '../utils/currencyFormat'

const props = defineProps({
  merchants: { type: Array, default: () => [] },
  selectedMerchantId: { type: String, default: '' },
})

const performanceDaily = ref([])
const transactions = ref([])
const selectedMerchantId = ref('')

watch(() => props.selectedMerchantId, (id) => {
  selectedMerchantId.value = id || ''
  load()
}, { immediate: true })
const startDate = ref(new Date(Date.now() - 30 * 864e5).toISOString().slice(0, 10))
const endDate = ref(new Date().toISOString().slice(0, 10))
const network = ref('')

const merchantDisplayName = computed(() => {
  if (!selectedMerchantId.value) return ''
  const m = props.merchants.find(m => String(m.id) === String(selectedMerchantId.value))
  return m ? m.name : ''
})

const clickData = computed(() => {
  const perf = performanceDaily.value
  if (perf.length > 0) {
    return perf.map(r => ({
      date: r.date,
      merchant_name: r.merchant_name || '',
      network: r.network || '',
      clicks: Number(r.clicks || 0),
      impressions: Number(r.impressions || 0),
      publisher: null,
      publisher_id: null,
      actions: Number(r.transactions || 0),
      revenue: Number(r.revenue || 0),
      commission: Number(r.commission || 0),
    })).sort((a, b) => b.date.localeCompare(a.date))
  }
  const map = {}
  transactions.value.forEach(t => {
    const date = (t.transaction_datetime_utc || '').slice(0, 10)
    const pub = t.publisher_name || t.merchant_name || 'Unknown'
    const pid = t.publisher_id || ''
    const merch = t.merchant_name || ''
    const key = date + '|' + (pid || pub) + '|' + (t.network || '')
      if (!map[key]) {
        map[key] = {
          date,
          merchant_name: merch,
          publisher: pub,
          publisher_id: pid,
          network: t.network || '',
          clicks: 0,
          impressions: 0,
          actions: 0,
          revenue: 0,
          commission: 0,
        }
      }
      map[key].actions += 1
      map[key].revenue += Number(t.amount || 0)
      map[key].commission += Number(t.commission || 0)
  })
  return Object.values(map).sort((a, b) => b.date.localeCompare(a.date))
})

const totalClicks = computed(() => clickData.value.reduce((s, r) => s + (r.clicks || 0), 0))
const totalActions = computed(() => clickData.value.reduce((s, r) => s + (r.actions || 0), 0))

const tableCurrency = computed(() => {
  if (network.value) return defaultCurrencyForNetwork(network.value)
  if (selectedMerchantId.value) {
    const m = props.merchants.find(x => String(x.id) === String(selectedMerchantId.value))
    if (m) return defaultCurrencyForNetwork(m.network)
  }
  const nets = new Set(clickData.value.map(r => (r.network || '').toLowerCase()).filter(Boolean))
  if (nets.size === 1) return defaultCurrencyForNetwork([...nets][0])
  return 'USD'
})

function formatCurrency(v) {
  return formatMoneyAmount(v, tableCurrency.value)
}

function formatRowMoney(v, net) {
  return formatMoneyAmount(v, defaultCurrencyForNetwork(net))
}

const totalRevenue = computed(() => formatCurrency(clickData.value.reduce((s, r) => s + (r.revenue || 0), 0)))

function exportCSV() {
  const rows = [['Date', 'Merchant', 'Network', 'Clicks', 'Impressions', 'Partner', 'Partner ID', 'Transactions', 'Revenue', 'Commission', 'Conv. Rate']]
  clickData.value.forEach(r => {
    const cr = r.clicks ? ((r.actions / r.clicks) * 100).toFixed(1) + '%' : '—'
    rows.push([r.date, r.merchant_name ?? '', r.network, r.clicks, r.impressions ?? '', r.publisher ?? '', r.publisher_id || '', r.actions, r.revenue, r.commission ?? '', cr])
  })
  const csv = rows.map(row => row.join(',')).join('\n')
  const blob = new Blob([csv], { type: 'text/csv' })
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = 'clicks.csv'; a.click()
}

async function load() {
  const params = { start_date: startDate.value, end_date: endDate.value, limit: 5000 }
  if (network.value) params.network = network.value
  if (selectedMerchantId.value) params.merchant_id = selectedMerchantId.value

  const [perfRes, txRes] = await Promise.allSettled([
    api.performanceDaily(params),
    api.transactions(params),
  ])

  const perf = perfRes.status === 'fulfilled' ? perfRes.value : { success: false, data: [] }
  const tx = txRes.status === 'fulfilled' ? txRes.value : { success: false, data: [] }

  performanceDaily.value = (perf.success && perf.data?.length) ? perf.data : []
  transactions.value = tx.success ? (tx.data || []) : []
}

onMounted(load)

</script>
