<template>
  <div>
    <div class="page-title-card">
      <h4 class="page-title">Publisher Performance</h4>
      <p class="page-subtitle">Detailed publisher performance metrics for merchant {{ selectedMerchantName || 'all' }}</p>
    </div>

    <div class="affilient-card mb-3" style="padding:1rem 1.25rem;">
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
          <button class="btn btn-update btn-sm" @click="load">&#128269; Apply</button>
        </div>
      </div>
    </div>

    <div class="table-card">
      <div class="table-card-header">
        <h5>Publisher Performance</h5>
        <span style="font-size:1rem;">&#128202;</span>
      </div>
      <div class="table-card-body">
        <div class="summary-bar">
          <div class="summary-title">
            Period: {{ startDate }} to {{ endDate }} ({{ publishers.length }} publishers)
          </div>
          <div class="summary-details">
            Clicks: {{ totals.clicks }} Actions: {{ totals.actions }} Revenue: {{ formatCurrency(totals.revenue) }} Commission: {{ formatCurrency(totals.commission) }}
          </div>
        </div>
        <div class="d-flex justify-content-end mb-2">
          <button class="btn-export" @click="exportCSV">&#128229; Export &#9660;</button>
        </div>
        <div style="overflow-x:auto;">
          <table class="affilient-table">
            <thead>
              <tr>
                <th><input type="checkbox" /></th>
                <th>Publisher</th>
                <th>Network</th>
                <th>Clicks</th>
                <th>Impressions</th>
                <th>Actions</th>
                <th>Revenue</th>
                <th>Commission</th>
              </tr>
            </thead>
            <tbody>
              <tr class="totals-row">
                <td></td>
                <td>TOTALS</td>
                <td>ALL</td>
                <td>{{ totals.clicks }}</td>
                <td>{{ totals.impressions }}</td>
                <td>{{ totals.actions }}</td>
                <td>{{ formatCurrency(totals.revenue) }}</td>
                <td>{{ formatCurrency(totals.commission) }}</td>
              </tr>
              <tr v-for="p in publishers" :key="p.name">
                <td><input type="checkbox" /></td>
                <td>
                  <div class="fw-semibold">{{ p.name }}</div>
                  <div style="font-size:0.7rem; color:var(--text-muted);">{{ p.id }}</div>
                </td>
                <td>
                  <span class="badge-network" :class="'badge-' + (p.network || '').toLowerCase()">
                    {{ (p.network || '').toUpperCase() }}
                  </span>
                </td>
                <td>{{ p.clicks }}</td>
                <td>{{ p.impressions }}</td>
                <td>{{ p.actions }}</td>
                <td>{{ formatRowMoney(p.revenue, p.network) }}</td>
                <td>{{ formatRowMoney(p.commission, p.network) }}</td>
              </tr>
              <tr v-if="publishers.length === 0">
                <td colspan="8" class="text-muted text-center py-3">No data. Run Sync first (Dashboard → Fetch Data), then select a merchant and date range.</td>
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

const publisherPerf = ref([])
const selectedMerchantId = ref('')

const selectedMerchantName = computed(() => {
  if (!selectedMerchantId.value) return ''
  const m = props.merchants.find(m => String(m.id) === String(selectedMerchantId.value))
  return m ? m.name : ''
})

watch(() => props.presetMerchantId, (id) => {
  selectedMerchantId.value = id || ''
  load()
}, { immediate: true })
const startDate = ref(new Date(Date.now() - 30 * 864e5).toISOString().slice(0, 10))
const endDate = ref(new Date().toISOString().slice(0, 10))

const publishers = computed(() => {
  return (publisherPerf.value || []).map(p => ({
    name: p.publisher_name || p.publisher_id || 'Unknown',
    id: p.publisher_id || '',
    network: p.network || '',
    clicks: Number(p.clicks || 0),
    impressions: Number(p.impressions || 0),
    actions: Number(p.actions || 0),
    revenue: Number(p.revenue || 0),
    commission: Number(p.commission || 0),
  }))
})

const totals = computed(() => {
  let clicks = 0, impressions = 0, actions = 0, revenue = 0, commission = 0
  publishers.value.forEach(p => {
    clicks += p.clicks; impressions += p.impressions; actions += p.actions
    revenue += p.revenue; commission += p.commission
  })
  return { clicks, impressions, actions, revenue, commission }
})

const tableCurrency = computed(() => {
  if (selectedMerchantId.value) {
    const m = props.merchants.find(x => String(x.id) === String(selectedMerchantId.value))
    if (m) return defaultCurrencyForNetwork(m.network)
  }
  const nets = new Set(publishers.value.map(p => (p.network || '').toLowerCase()).filter(Boolean))
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
  const rows = [['Publisher', 'Network', 'Clicks', 'Impressions', 'Actions', 'Revenue', 'Commission']]
  publishers.value.forEach(p => rows.push([p.name, p.network, p.clicks, p.impressions, p.actions, p.revenue, p.commission]))
  const csv = rows.map(r => r.join(',')).join('\n')
  const blob = new Blob([csv], { type: 'text/csv' })
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = 'publisher_performance.csv'; a.click()
}

async function load() {
  try {
    const params = { start_date: startDate.value, end_date: endDate.value }
    if (selectedMerchantId.value) params.merchant_id = selectedMerchantId.value
    const r = await api.performancePublishers(params)
    let rows = r.success ? r.data || [] : []
    if (!rows.length && selectedMerchantId.value) {
      const dr = await api.performanceDaily(params).catch(() => ({ success: false }))
      if (dr.success && Array.isArray(dr.data) && dr.data.length) {
        let clicks = 0
        let impressions = 0
        let actions = 0
        let revenue = 0
        let commission = 0
        dr.data.forEach((row) => {
          clicks += Number(row.clicks || 0)
          impressions += Number(row.impressions || 0)
          actions += Number(row.transactions || 0)
          revenue += Number(row.revenue || 0)
          commission += Number(row.commission || 0)
        })
        rows = [
          {
            network: String(dr.data[0]?.network || '').toLowerCase(),
            publisher_id: '__merchant_daily_total__',
            publisher_name: '— Σύνολο merchant (χωρίς ανά publisher στο DB)',
            clicks,
            impressions,
            actions,
            revenue,
            commission,
          },
        ]
      }
    }
    publisherPerf.value = rows
  } catch (_) {
    publisherPerf.value = []
  }
}

onMounted(load)

</script>
