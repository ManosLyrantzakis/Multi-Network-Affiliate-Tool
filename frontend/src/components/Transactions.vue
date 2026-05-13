<template>
  <div>
    <h1>Transactions</h1>
    <div class="row g-2 mb-3">
      <div class="col-md-2">
        <input v-model="filters.start_date" type="date" class="form-control" placeholder="Start" />
      </div>
      <div class="col-md-2">
        <input v-model="filters.end_date" type="date" class="form-control" placeholder="End" />
      </div>
      <div class="col-md-2">
        <select v-model="filters.merchant_id" class="form-select">
          <option value="">All Merchants</option>
          <option v-for="m in merchants" :key="m.id" :value="m.id">{{ m.name }}</option>
        </select>
      </div>
      <div class="col-md-2">
        <select v-model="filters.network" class="form-select">
          <option value="">All Networks</option>
          <option value="awin">AWIN</option>
          <option value="cj">CJ</option>
          <option value="impact">Impact</option>
          <option value="webgains">Webgains</option>
        </select>
      </div>
      <div class="col-md-2">
        <select v-model="filters.status" class="form-select">
          <option value="">All Status</option>
          <option value="approved">Approved</option>
          <option value="pending">Pending</option>
          <option value="declined">Declined</option>
        </select>
      </div>
      <div class="col-md-2">
        <button class="btn btn-primary w-100" @click="load">Apply</button>
      </div>
    </div>
    <div class="table-responsive">
      <table class="table table-striped table-hover">
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
            <td>{{ t.external_id }}</td>
            <td>{{ t.merchant_name }}</td>
            <td><span class="badge bg-secondary">{{ t.network }}</span></td>
            <td>{{ transactionDisplayCurrency(t.currency, t.network) }}</td>
            <td>{{ formatCurrency(t.amount, t.currency, t.network) }}</td>
            <td>{{ formatCurrency(t.commission, t.currency, t.network) }}</td>
            <td>
              <span class="badge" :class="statusClass(t.status)">{{ t.status }}</span>
            </td>
            <td>{{ formatDate(t.transaction_datetime_utc) }}</td>
          </tr>
        </tbody>
      </table>
    </div>
  </div>
</template>

<script setup>
import { ref, onMounted, watch } from 'vue'
import { api } from '../api'
import { formatMoneyAmount, transactionDisplayCurrency } from '../utils/currencyFormat'

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

function statusClass(s) {
  if (s === 'approved') return 'bg-success'
  if (s === 'declined') return 'bg-danger'
  return 'bg-warning text-dark'
}

function formatCurrency(v, c, network) {
  return formatMoneyAmount(v, transactionDisplayCurrency(c, network))
}

function formatDate(d) {
  if (!d) return '-'
  return new Date(d).toLocaleString()
}

async function load() {
  try {
    const params = {}
    if (filters.value.start_date) params.start_date = filters.value.start_date
    if (filters.value.end_date) params.end_date = filters.value.end_date
    if (filters.value.merchant_id) params.merchant_id = filters.value.merchant_id
    if (filters.value.network) params.network = filters.value.network
    if (filters.value.status) params.status = filters.value.status
    const r = await api.transactions(params)
    if (r.success) transactions.value = r.data || []
  } catch (e) {
    emit('message', e.message || 'Load failed', 'danger')
  }
}

watch(() => props.selectedMerchantId, (id) => {
  filters.value.merchant_id = id || ''
  load()
}, { immediate: true })
</script>
