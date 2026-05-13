<template>
  <div class="fetch-modal-overlay" @click.self="$emit('close')">
    <div class="card affilient-card fetch-data-card">
      <div class="card-header d-flex justify-content-between align-items-center">
        <h5 class="mb-0">Fetch Data</h5>
        <button type="button" class="btn-close" aria-label="Close" @click="$emit('close')"></button>
      </div>
      <div class="card-body">
        <div class="mb-3">
          <label class="form-label fw-semibold">Merchant *</label>
          <select v-model="form.merchant_id" class="form-select">
            <option value="">Select a merchant...</option>
            <option v-for="m in merchants" :key="m.id" :value="m.id">
              {{ m.name }} ({{ m.network }})
            </option>
          </select>
        </div>

        <div class="mb-3">
          <label class="form-label">Network</label>
          <input
            :value="displayNetwork"
            class="form-control"
            readonly
            style="background:#f8fafc;"
          />
        </div>

        <div class="mb-1"><label class="form-label">Date Range</label></div>
        <div class="row g-2 mb-1">
          <div class="col-6">
            <label class="form-label text-muted" style="font-size:0.75rem;">From</label>
            <input v-model="form.start_date" type="date" class="form-control" />
          </div>
          <div class="col-6">
            <label class="form-label text-muted" style="font-size:0.75rem;">To</label>
            <input v-model="form.end_date" type="date" class="form-control" />
          </div>
        </div>
        <p class="text-green mb-3" style="font-size:0.72rem;">
          Leave empty if merchant has Fetch Start Date set (will be used automatically)
        </p>

        <div class="mb-3">
          <label class="form-label">Data Type</label>
          <select v-model="form.data_type" class="form-select">
            <option value="all">All the above</option>
            <option value="transactions">Transactions</option>
            <option value="clicks">Clicks</option>
            <option value="publishers">Publishers</option>
          </select>
        </div>

        <div class="form-check mb-3">
          <input v-model="form.force_refresh" class="form-check-input" type="checkbox" id="forceRefresh">
          <label class="form-check-label" for="forceRefresh">
            Force refresh (skip existing data)
          </label>
          <span class="form-check-help">Check this to re-fetch data even if it already exists in the database</span>
        </div>

        <div class="d-flex gap-2">
          <button
            type="button"
            class="btn btn-fetch-data"
            :disabled="loading || !form.merchant_id"
            @click="submit"
          >
            &#9654; {{ loading ? 'Fetching...' : 'Start Fetch' }}
          </button>
          <button class="btn btn-outline-secondary btn-sm" @click="$emit('close')">Cancel</button>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, computed, onMounted } from 'vue'

const props = defineProps({
  merchants: { type: Array, default: () => [] },
  loading: { type: Boolean, default: false },
})

const emit = defineEmits(['close', 'sync'])

const form = ref({
  merchant_id: '',
  start_date: '',
  end_date: '',
  data_type: 'all',
  force_refresh: false,
})

const displayNetwork = computed(() => {
  if (!form.value.merchant_id) return 'Auto-detect from merchant'
  const m = props.merchants.find(x => String(x.id) === String(form.value.merchant_id))
  return m ? m.network : 'Auto-detect from merchant'
})

function submit() {
  const body = {
    start_date: form.value.start_date,
    end_date: form.value.end_date,
  }
  if (form.value.merchant_id) {
    body.merchant_id = parseInt(form.value.merchant_id, 10)
  }
  if (form.value.data_type !== 'all') {
    body.data_type = form.value.data_type
  }
  if (form.value.force_refresh) {
    body.force_refresh = true
  }
  emit('sync', body)
}

onMounted(() => {
  form.value.start_date = new Date(Date.now() - 7 * 864e5).toISOString().slice(0, 10)
  form.value.end_date = new Date().toISOString().slice(0, 10)
})
</script>
