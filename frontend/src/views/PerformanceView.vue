<template>
  <div>
    <h1>Performance</h1>
    <div class="row g-3 mb-4">
      <div class="col-md-3">
        <div class="card">
          <div class="card-body">
            <h6 class="card-subtitle text-muted">Total Transactions</h6>
            <p class="card-text display-6">{{ stats.total_count ?? 0 }}</p>
          </div>
        </div>
      </div>
      <div class="col-md-3">
        <div class="card">
          <div class="card-body">
            <h6 class="card-subtitle text-muted">Approved</h6>
            <p class="card-text display-6 text-success">{{ stats.approved_count ?? 0 }}</p>
          </div>
        </div>
      </div>
      <div class="col-md-3">
        <div class="card">
          <div class="card-body">
            <h6 class="card-subtitle text-muted">Total Revenue</h6>
            <p class="card-text display-6">{{ formatCurrency(stats.total_revenue) }}</p>
          </div>
        </div>
      </div>
      <div class="col-md-3">
        <div class="card">
          <div class="card-body">
            <h6 class="card-subtitle text-muted">Total Commission</h6>
            <p class="card-text display-6">{{ formatCurrency(stats.total_commission) }}</p>
          </div>
        </div>
      </div>
    </div>
    <div class="mb-3">
      <label class="form-label">Filter by Merchant</label>
      <select v-model="merchantId" class="form-select w-auto" @change="load">
        <option value="">All Merchants</option>
        <option v-for="m in merchants" :key="m.id" :value="m.id">{{ m.name }}</option>
      </select>
    </div>
  </div>
</template>

<script setup>
import { ref, onMounted, watch } from 'vue'
import { api } from '../api'
import { useAppStore } from '../stores/app'

const appStore = useAppStore()
const merchants = ref([])
const stats = ref({})
const merchantId = ref('')

function formatCurrency(v) {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'EUR' }).format(Number(v) || 0)
}

async function load() {
  try {
    const params = merchantId.value ? { merchant_id: merchantId.value } : {}
    const r = await api.performance(params)
    if (r.success) stats.value = r.data || {}
  } catch (_) {}
}

onMounted(async () => {
  try {
    const r = await api.merchants()
    if (r.success) merchants.value = r.data || []
  } catch (_) {}
  load()
})
watch(merchantId, load)
</script>
