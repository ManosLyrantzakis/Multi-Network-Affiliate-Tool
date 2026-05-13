<template>
  <div>
    <div class="page-title-card">
      <h4 class="page-title">Transaction Details</h4>
      <p class="page-subtitle">Detailed transaction records and status tracking</p>
    </div>

    <!-- Filters -->
    <div class="affilient-card" style="padding:1rem 1.25rem; margin-bottom:1rem;">
      <div class="row g-2 align-items-end">
        <div class="col-md-2">
          <label class="form-label" style="font-size:0.8rem;">Start Date</label>
          <input v-model="filters.start_date" type="date" class="form-control form-control-sm" />
        </div>
        <div class="col-md-2">
          <label class="form-label" style="font-size:0.8rem;">End Date</label>
          <input v-model="filters.end_date" type="date" class="form-control form-control-sm" />
        </div>
        <div class="col-md-2">
          <label class="form-label" style="font-size:0.8rem;">Merchant</label>
          <select v-model="filters.merchant_id" class="form-select form-select-sm">
            <option value="">All</option>
            <option v-for="m in merchants" :key="m.id" :value="m.id">{{ m.name }}</option>
          </select>
        </div>
        <div class="col-md-2">
          <label class="form-label" style="font-size:0.8rem;">Network</label>
          <select v-model="filters.network" class="form-select form-select-sm">
            <option value="">All</option>
            <option value="awin">AWIN</option>
            <option value="cj">CJ</option>
            <option value="impact">Impact</option>
            <option value="webgains">Webgains</option>
          </select>
        </div>
        <div class="col-md-2">
          <label class="form-label" style="font-size:0.8rem;">Status</label>
          <select v-model="filters.status" class="form-select form-select-sm">
            <option value="">All</option>
            <option value="approved">Approved</option>
            <option value="pending">Pending</option>
            <option value="declined">Declined</option>
          </select>
        </div>
        <div class="col-md-2">
          <button class="btn btn-update btn-sm w-100" @click="load">&#128269; Apply</button>
        </div>
      </div>
    </div>

    <!-- Table -->
    <div class="table-card">
      <div class="table-card-header">
        <h5>Transactions</h5>
        <button class="btn-export" @click="exportCSV">&#128229; Export</button>
      </div>
      <div class="table-card-body">
        <div class="summary-bar">
          <div class="summary-title">{{ transactions.length }} transactions found</div>
          <div class="summary-details" v-if="transactions.length && totalsMixedCurrency">
            <span class="text-muted small d-block mb-1">Σύνολα χωριστά ανά νόμισμα (αθροίσματα δεν αναμειγνύονται EUR+DKK):</span>
            <span v-for="(tot, cur) in totalsByCurrency" :key="cur" class="me-3">
              <strong>{{ cur }}</strong>:
              revenue {{ formatMoneyAmount(tot.revenue, cur) }},
              commission {{ formatMoneyAmount(tot.commission, cur) }}
            </span>
          </div>
          <div class="summary-details" v-else-if="transactions.length">
            Revenue: {{ formatMoneyAmount(totals.revenue, totalsCurrency) }} Commission: {{ formatMoneyAmount(totals.commission, totalsCurrency) }}
          </div>
        </div>
        <div style="overflow-x:auto;">
          <table class="affilient-table">
            <thead>
              <tr>
                <th>ID</th>
                <th>Merchant</th>
                <th>Network</th>
                <th>Curr</th>
                <th>Amount</th>
                <th>Commission</th>
                <th>Status</th>
                <th>Date</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="t in transactions" :key="t.id">
                <td style="font-size:0.8rem;">{{ t.external_id || t.id }}</td>
                <td class="fw-semibold">{{ t.merchant_name || '—' }}</td>
                <td>
                  <span class="badge-network" :class="'badge-' + (t.network || '').toLowerCase()">
                    {{ (t.network || '').toUpperCase() }}
                  </span>
                </td>
                <td style="font-size:0.8rem;">{{ transactionDisplayCurrency(t.currency, t.network) }}</td>
                <td>{{ formatMoneyAmount(t.amount, transactionDisplayCurrency(t.currency, t.network)) }}</td>
                <td>{{ formatMoneyAmount(t.commission, transactionDisplayCurrency(t.currency, t.network)) }}</td>
                <td>
                  <span class="badge" :class="statusClass(t.status)">{{ t.status || 'unknown' }}</span>
                </td>
                <td style="font-size:0.8rem;">{{ formatDate(t.transaction_datetime_utc) }}</td>
              </tr>
              <tr v-if="transactions.length === 0">
                <td colspan="8" class="text-muted text-center py-3">No transactions found.</td>
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
import { defaultCurrencyForNetwork, formatMoneyAmount, transactionDisplayCurrency } from '../utils/currencyFormat'

const props = defineProps({
  merchants: { type: Array, default: () => [] },
  selectedMerchantId: { type: String, default: '' },
})
const emit = defineEmits(['message'])

const transactions = ref([])
const filters = ref({
  start_date: new Date(Date.now() - 30 * 864e5).toISOString().slice(0, 10),
  end_date: new Date().toISOString().slice(0, 10),
  merchant_id: '',
  network: '',
  status: '',
})

watch(() => props.selectedMerchantId, (id) => {
  filters.value.merchant_id = id || ''
  load()
}, { immediate: true })

const totals = computed(() => {
  let revenue = 0, commission = 0
  transactions.value.forEach(t => {
    revenue += Number(t.amount || 0)
    commission += Number(t.commission || 0)
  })
  return { revenue, commission }
})

const totalsCurrency = computed(() => {
  if (filters.value.network) return transactionDisplayCurrency(null, filters.value.network)
  if (filters.value.merchant_id) {
    const m = props.merchants.find(x => String(x.id) === String(filters.value.merchant_id))
    if (m) return defaultCurrencyForNetwork(m.network)
  }
  const row = transactions.value[0]
  if (row) return transactionDisplayCurrency(row.currency, row.network)
  return 'EUR'
})

const totalsByCurrency = computed(() => {
  const m = {}
  for (const t of transactions.value) {
    const c = transactionDisplayCurrency(t.currency, t.network)
    if (!m[c]) m[c] = { revenue: 0, commission: 0 }
    m[c].revenue += Number(t.amount || 0)
    m[c].commission += Number(t.commission || 0)
  }
  return m
})

const totalsMixedCurrency = computed(() => Object.keys(totalsByCurrency.value).length > 1)

function formatDate(d) {
  if (!d) return '—'
  return new Date(d).toLocaleString()
}

function statusClass(s) {
  if (s === 'approved') return 'bg-success'
  if (s === 'declined') return 'bg-danger'
  return 'bg-warning text-dark'
}

function exportCSV() {
  const rows = [['ID', 'Merchant', 'Network', 'Curr', 'Amount', 'Commission', 'Status', 'Date']]
  transactions.value.forEach(t => {
    const cur = transactionDisplayCurrency(t.currency, t.network)
    rows.push([t.external_id || t.id, t.merchant_name, t.network, cur, t.amount, t.commission, t.status, t.transaction_datetime_utc])
  })
  const csv = rows.map(r => r.join(',')).join('\n')
  const blob = new Blob([csv], { type: 'text/csv' })
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = 'transactions.csv'; a.click()
}

async function load() {
  try {
    const params = {}
    Object.entries(filters.value).forEach(([k, v]) => { if (v) params[k] = v })
    const r = await api.transactions(params)
    if (r.success) transactions.value = r.data || []
  } catch (e) {
    emit('message', e.message || 'Load failed', 'danger')
  }
}

onMounted(load)
</script>
