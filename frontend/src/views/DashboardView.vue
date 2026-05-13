<template>
  <div>
    <h1>Dashboard</h1>
    <div class="row g-3 mb-4">
      <div class="col-md-4">
        <div class="card">
          <div class="card-body">
            <h5 class="card-title">Merchants</h5>
            <p class="card-text display-6">{{ stats.merchant_count ?? 0 }}</p>
          </div>
        </div>
      </div>
      <div class="col-md-4">
        <div class="card">
          <div class="card-body">
            <h5 class="card-title">Total Transactions</h5>
            <p class="card-text display-6">{{ stats.total_count ?? 0 }}</p>
          </div>
        </div>
      </div>
      <div class="col-md-4">
        <div class="card">
          <div class="card-body">
            <h5 class="card-title">Total Revenue</h5>
            <p class="card-text display-6">{{ formatCurrency(stats.total_revenue) }}</p>
          </div>
        </div>
      </div>
    </div>
    <div class="card">
      <div class="card-header d-flex justify-content-between align-items-center">
        <span>Manual Sync</span>
        <button class="btn btn-primary" :disabled="loading" @click="runSync">
          {{ loading ? 'Syncing...' : 'Run Sync' }}
        </button>
      </div>
      <div class="card-body">
        <div class="row g-2">
          <div class="col-md-4">
            <label class="form-label">Start Date</label>
            <input v-model="startDate" type="date" class="form-control" />
          </div>
          <div class="col-md-4">
            <label class="form-label">End Date</label>
            <input v-model="endDate" type="date" class="form-control" />
          </div>
          <div class="col-md-4">
            <label class="form-label">Merchant</label>
            <select v-model="merchantId" class="form-select">
              <option value="">All</option>
              <option v-for="m in merchants" :key="m.id" :value="m.id">{{ m.name }} ({{ m.network }})</option>
            </select>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, onMounted } from 'vue'
import { api } from '../api'
import { useAppStore } from '../stores/app'

const appStore = useAppStore()
const loading = ref(false)
const stats = ref({})
const merchants = ref([])
const startDate = ref('')
const endDate = ref('')
const merchantId = ref('')

function formatCurrency(v) {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'EUR' }).format(Number(v) || 0)
}

async function runSync() {
  loading.value = true
  try {
    const body = { start_date: startDate.value, end_date: endDate.value }
    if (merchantId.value) body.merchant_id = parseInt(merchantId.value, 10)
    const r = await api.sync(body)
    appStore.setMessage(`Synced ${r.data?.transaction_count ?? 0} transactions`, 'success')
    await loadStats()
  } catch (e) {
    appStore.setMessage(e.message || 'Sync failed', 'danger')
  } finally {
    loading.value = false
  }
}

async function loadStats() {
  try {
    const [m, p] = await Promise.all([api.merchants(), api.performance()])
    if (m.success) merchants.value = m.data || []
    if (p.success) stats.value = p.data || {}
    stats.value.merchant_count = merchants.value.length
  } catch (_) {}
}

onMounted(() => {
  const today = new Date().toISOString().slice(0, 10)
  const week = new Date(Date.now() - 7 * 864e5).toISOString().slice(0, 10)
  startDate.value = week
  endDate.value = today
  loadStats()
})
</script>
