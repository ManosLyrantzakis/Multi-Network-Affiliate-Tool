<template>
  <div>
    <div class="page-title-card">
      <h4 class="page-title">Transaction Validation</h4>
      <p class="page-subtitle">Approve or decline pending transactions (AWIN & Impact)</p>
    </div>

    <!-- Filters -->
    <div class="affilient-card mb-3" style="padding:1rem 1.25rem;">
      <div class="row g-2 align-items-end">
        <div class="col-md-2">
          <label class="form-label" style="font-size:0.8rem;">Merchant</label>
          <select v-model="merchantId" class="form-select form-select-sm" @change="loadPending">
            <option value="">All (AWIN & Impact)</option>
            <option v-for="m in validationMerchants" :key="m.id" :value="m.id">{{ m.name }} ({{ (m.network || '').toUpperCase() }})</option>
          </select>
        </div>
        <div class="col-md-2">
          <button class="btn btn-update btn-sm w-100" @click="loadPending" :disabled="loading">&#128260; Refresh</button>
        </div>
      </div>
    </div>

    <!-- Pending Transactions Table -->
    <div class="table-card">
      <div class="table-card-header">
        <h5>Pending Transactions ({{ pending.length }})</h5>
      </div>
      <div class="table-card-body">
        <div v-if="loading" class="text-center py-4 text-muted">Loading pending transactions...</div>
        <div v-else-if="!validationMerchants.length" class="text-center py-4 text-muted">
          No AWIN or Impact merchants. Add a merchant first.
        </div>
        <div v-else-if="pending.length === 0" class="text-center py-4 text-muted">
          No pending transactions. Use Fetch Data to sync.
        </div>
        <div v-else style="overflow-x:auto;">
          <table class="affilient-table validation-table">
            <thead>
              <tr>
                <th>ID</th>
                <th>Merchant</th>
                <th>Amount</th>
                <th>Commission</th>
                <th>Publisher</th>
                <th>Date</th>
                <th class="validation-actions-col">Actions</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="t in pending" :key="t.id" :class="{ 'row-processing': processingIds.has(t.id) }">
                <td style="font-size:0.8rem;">{{ t.external_id || t.id }}</td>
                <td class="fw-semibold">{{ t.merchant_name || '—' }}</td>
                <td>{{ formatMoneyAmount(t.amount, transactionDisplayCurrency(t.currency, t.network)) }}</td>
                <td>{{ formatMoneyAmount(t.commission, transactionDisplayCurrency(t.currency, t.network)) }}</td>
                <td style="font-size:0.85rem;">{{ t.publisher_id || '—' }}</td>
                <td style="font-size:0.8rem;">{{ formatDate(t.transaction_datetime_utc) }}</td>
                <td class="validation-actions-cell">
                  <button
                    class="btn btn-sm btn-success validation-btn"
                    :disabled="loading || processingIds.has(t.id)"
                    @click="acceptOne(t)"
                  >
                    Accept
                  </button>
                  <div class="decline-dropdown" v-if="declineOpenId === t.id">
                    <div class="decline-dropdown-header">Select decline reason</div>
                    <button
                      v-for="r in declineReasons"
                      :key="r"
                      class="decline-reason-btn"
                      @click="declineOne(t, r)"
                    >
                      {{ r }}
                    </button>
                    <button class="decline-cancel-btn" @click="declineOpenId = null">Cancel</button>
                  </div>
                  <button
                    v-else
                    class="btn btn-sm btn-danger validation-btn"
                    :disabled="loading || processingIds.has(t.id)"
                    @click="declineOpenId = t.id"
                  >
                    Decline
                  </button>
                </td>
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
import { formatMoneyAmount, transactionDisplayCurrency } from '../utils/currencyFormat'

const props = defineProps({
  merchants: { type: Array, default: () => [] },
  selectedMerchantId: { type: String, default: '' },
})
const emit = defineEmits(['message'])

const awinMerchants = computed(() => (props.merchants || []).filter(m => (m.network || '').toLowerCase() === 'awin'))

const validationMerchants = computed(() =>
  (props.merchants || []).filter(m => ['awin', 'impact'].includes((m.network || '').toLowerCase()))
)

// Decline reasons - edit this list later
const declineReasons = [
  'order returned',
  'fraud',
  'duplicate transaction',
  'customer cancellation',
  'invalid sale',
  'terms violation',
  'late delivery',
  'product not as described',
  'other',
  'declined by user',
]

const merchantId = ref('')

watch(() => props.selectedMerchantId, (id) => {
  if (id) {
    merchantId.value = id
    loadPending()
  }
}, { immediate: true })
const pending = ref([])
const loading = ref(false)
const processingIds = ref(new Set())
const declineOpenId = ref(null)

function formatDate(d) {
  if (!d) return '—'
  return new Date(d).toLocaleString()
}

async function loadPending() {
  loading.value = true
  try {
    if (merchantId.value) {
      const r = await api.transactions({ status: 'pending', merchant_id: merchantId.value })
      pending.value = r.success ? (r.data || []) : []
    } else {
      const [rAwin, rImpact] = await Promise.all([
        api.transactions({ status: 'pending', network: 'awin' }),
        api.transactions({ status: 'pending', network: 'impact' }),
      ])
      const awin = rAwin.success ? (rAwin.data || []) : []
      const impact = rImpact.success ? (rImpact.data || []) : []
      pending.value = [...awin, ...impact].sort((a, b) => (b.transaction_datetime_utc || '').localeCompare(a.transaction_datetime_utc || ''))
    }
  } catch (e) {
    emit('message', e.message || 'Failed to load pending transactions', 'danger')
    pending.value = []
  } finally {
    loading.value = false
  }
}

async function acceptOne(t) {
  const ids = new Set([String(t.id)])
  processingIds.value = new Set([...processingIds.value, t.id])
  declineOpenId.value = null
  try {
    const body = {
      transaction_ids: Array.from(ids),
      action: 'approve',
      merchant_id: t.merchant_id ? parseInt(t.merchant_id, 10) : (merchantId.value ? parseInt(merchantId.value, 10) : null),
    }
    await api.validation(body)
    emit('message', 'Transaction approved', 'success')
    await loadPending()
  } catch (e) {
    emit('message', e.message || 'Approve failed', 'danger')
  } finally {
    const s = new Set(processingIds.value)
    s.delete(t.id)
    processingIds.value = s
  }
}

async function declineOne(t, reason) {
  const ids = new Set([String(t.id)])
  processingIds.value = new Set([...processingIds.value, t.id])
  declineOpenId.value = null
  try {
    const body = {
      transaction_ids: Array.from(ids),
      action: 'decline',
      decline_reason: reason,
      merchant_id: t.merchant_id ? parseInt(t.merchant_id, 10) : (merchantId.value ? parseInt(merchantId.value, 10) : null),
    }
    await api.validation(body)
    emit('message', 'Transaction declined', 'success')
    await loadPending()
  } catch (e) {
    emit('message', e.message || 'Decline failed', 'danger')
  } finally {
    const s = new Set(processingIds.value)
    s.delete(t.id)
    processingIds.value = s
  }
}

onMounted(loadPending)
</script>

<style scoped>
.validation-actions-col {
  min-width: 200px;
}
.validation-actions-cell {
  position: relative;
  white-space: nowrap;
}
.validation-btn {
  padding: 0.25rem 0.5rem;
  font-size: 0.8rem;
  margin-right: 0.35rem;
}
.decline-dropdown {
  position: absolute;
  top: 100%;
  left: 0;
  margin-top: 2px;
  background: var(--card-bg);
  border: 1px solid var(--border-color);
  border-radius: 6px;
  box-shadow: 0 4px 12px rgba(0,0,0,0.15);
  padding: 0.5rem;
  z-index: 10;
  min-width: 220px;
}
.decline-dropdown-header {
  font-size: 0.75rem;
  font-weight: 600;
  color: var(--text-secondary);
  margin-bottom: 0.5rem;
}
.decline-reason-btn {
  display: block;
  width: 100%;
  text-align: left;
  padding: 0.4rem 0.6rem;
  border: none;
  background: transparent;
  font-size: 0.85rem;
  cursor: pointer;
  border-radius: 4px;
}
.decline-reason-btn:hover {
  background: var(--bg-secondary, #f0f0f0);
}
.decline-cancel-btn {
  display: block;
  width: 100%;
  margin-top: 0.5rem;
  padding: 0.35rem;
  border: 1px solid var(--border-color);
  background: transparent;
  font-size: 0.8rem;
  cursor: pointer;
  border-radius: 4px;
  color: var(--text-muted);
}
.decline-cancel-btn:hover {
  background: var(--bg-secondary);
}
.row-processing {
  opacity: 0.7;
}
</style>
