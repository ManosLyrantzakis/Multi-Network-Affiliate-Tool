<template>
  <div>
    <div class="page-title-card">
      <h4 class="page-title">Publisher Information</h4>
      <p class="page-subtitle">Publisher details and performance for merchant {{ selectedMerchantName || 'all' }}</p>
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
        <h5>Publisher Information</h5>
        <span style="font-size:1rem;">&#128101;</span>
      </div>
      <div class="table-card-body">
        <div class="summary-bar">
          <div class="summary-title">Publishers ({{ publishers.length }} total)</div>
          <div class="summary-details">
            Clicks: {{ totals.clicks }} Actions: {{ totals.actions }} Revenue: {{ formatCurrency(totals.revenue) }}
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
                <th>Status</th>
                <th>Joined Date</th>
                <th>Clicks</th>
                <th>Actions</th>
                <th>Revenue</th>
              </tr>
            </thead>
            <tbody>
              <tr class="totals-row">
                <td></td>
                <td>TOTALS</td>
                <td>ALL</td>
                <td>-</td>
                <td>-</td>
                <td>{{ totals.clicks }}</td>
                <td>{{ totals.actions }}</td>
                <td>{{ formatCurrency(totals.revenue) }}</td>
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
                <td><span class="badge-active">ACTIVE</span></td>
                <td>{{ p.joined_date || '—' }}</td>
                <td>{{ p.clicks }}</td>
                <td>{{ p.actions }}</td>
                <td>{{ formatRowMoney(p.revenue, p.network) }}</td>
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

const transactions = ref([])
const selectedMerchantId = ref('')
const startDate = ref(new Date(Date.now() - 30 * 864e5).toISOString().slice(0, 10))
const endDate = ref(new Date().toISOString().slice(0, 10))

const selectedMerchantName = computed(() => {
  if (!selectedMerchantId.value) return ''
  const m = props.merchants.find(m => String(m.id) === String(selectedMerchantId.value))
  return m ? m.name : ''
})

watch(() => props.presetMerchantId, (id) => {
  selectedMerchantId.value = id || ''
  load()
}, { immediate: true })

const publishers = computed(() => {
  const map = {}
  transactions.value.forEach(t => {
    const key = (t.publisher_name || t.publisher_id || t.merchant_name || 'Unknown').toString()
    if (!map[key]) {
      map[key] = {
        name: key, id: t.publisher_id || '', network: t.network || '',
        clicks: 0, actions: 0, revenue: 0, joined_date: '',
      }
    }
    map[key].actions += 1
    map[key].revenue += Number(t.amount || 0)
  })
  return Object.values(map).sort((a, b) => b.revenue - a.revenue)
})

const totals = computed(() => {
  let clicks = 0, actions = 0, revenue = 0
  publishers.value.forEach(p => { clicks += p.clicks; actions += p.actions; revenue += p.revenue })
  return { clicks, actions, revenue }
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
  const rows = [['Publisher', 'Network', 'Status', 'Joined Date', 'Clicks', 'Actions', 'Revenue']]
  publishers.value.forEach(p => rows.push([p.name, p.network, 'ACTIVE', p.joined_date, p.clicks, p.actions, p.revenue]))
  const csv = rows.map(r => r.join(',')).join('\n')
  const blob = new Blob([csv], { type: 'text/csv' })
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = 'publisher_information.csv'; a.click()
}

async function load() {
  try {
    const params = { start_date: startDate.value, end_date: endDate.value, limit: 5000 }
    if (selectedMerchantId.value) params.merchant_id = selectedMerchantId.value
    const r = await api.transactions(params)
    if (r.success) transactions.value = r.data || []
  } catch (_) {}
}

</script>
