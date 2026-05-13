<template>
  <div>
    <h1>Validation</h1>
    <p class="text-muted">Approve or decline pending transactions.</p>
    <div class="row g-2 mb-3">
      <div class="col-md-3">
        <select v-model="merchantId" class="form-select">
          <option value="">Select Merchant</option>
          <option v-for="m in merchants" :key="m.id" :value="m.id">{{ m.name }} ({{ m.network }})</option>
        </select>
      </div>
      <div class="col-md-2">
        <input v-model="orderIds" class="form-control" placeholder="Order IDs (comma-separated)" />
      </div>
      <div class="col-md-2">
        <select v-model="action" class="form-select">
          <option value="approve">Approve</option>
          <option value="decline">Decline</option>
        </select>
      </div>
      <div class="col-md-2">
        <button class="btn btn-primary" :disabled="loading" @click="submit">
          {{ loading ? 'Processing...' : 'Submit' }}
        </button>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, onMounted } from 'vue'
import { api } from '../api'
import { useAppStore } from '../stores/app'

const appStore = useAppStore()
const merchants = ref([])
const merchantId = ref('')
const orderIds = ref('')
const action = ref('approve')
const loading = ref(false)

async function submit() {
  if (!merchantId.value) {
    appStore.setMessage('Select a merchant', 'warning')
    return
  }
  const ids = orderIds.value.split(/[\n,]/).map((s) => s.trim()).filter(Boolean)
  if (!ids.length) {
    appStore.setMessage('Enter at least one order ID', 'warning')
    return
  }
  loading.value = true
  try {
    await api.validation({ merchant_id: parseInt(merchantId.value, 10), transaction_ids: ids, action: action.value })
    appStore.setMessage(`Processed ${ids.length} transaction(s)`, 'success')
    orderIds.value = ''
  } catch (e) {
    appStore.setMessage(e.message || 'Validation failed', 'danger')
  } finally {
    loading.value = false
  }
}

onMounted(async () => {
  try {
    const r = await api.merchants()
    if (r.success) merchants.value = r.data || []
  } catch (_) {}
})
</script>
