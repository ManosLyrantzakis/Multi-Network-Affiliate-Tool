<template>
  <div>
    <div class="page-title-card">
      <h4 class="page-title">Merchants</h4>
      <p class="page-subtitle">Manage your affiliate merchant configurations</p>
    </div>

    <div class="d-flex justify-content-end mb-3">
      <button class="btn btn-add-merchant" @click="showForm(null)">
        &#10133; Add Merchant
      </button>
    </div>

    <!-- Merchants Table -->
    <div class="table-card" v-if="!formVisible">
      <div class="table-card-body">
        <table class="affilient-table">
          <thead>
            <tr>
              <th>Name</th>
              <th>Network</th>
              <th>API Key</th>
              <th>Timezone</th>
              <th>Status</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            <tr v-if="!loading && merchants.length === 0">
              <td colspan="6" class="text-muted text-center py-4">
                No merchants yet. Click "Add Merchant" to create one.
              </td>
            </tr>
            <tr v-for="m in merchants" :key="m.id">
              <td class="fw-semibold">{{ m.name }}</td>
              <td>
                <span class="badge-network" :class="'badge-' + (m.network || '').toLowerCase()">
                  {{ (m.network || '').toUpperCase() }}
                </span>
              </td>
              <td style="font-size:0.8rem; color: var(--text-muted);">
                {{ m.has_api_key ? '••••••••' : '—' }}
              </td>
              <td>{{ m.timezone || 'UTC' }}</td>
              <td>
                <span class="badge-active">ACTIVE</span>
              </td>
              <td>
                <button class="btn btn-sm btn-outline-primary" @click="showForm(m)">Edit</button>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>

    <!-- Add/Edit Merchant Form -->
    <div v-if="formVisible" class="merchant-form-card">
      <div class="merchant-form-header">
        <div>
          <h5>{{ editing ? 'Edit Merchant' : 'Add New Merchant' }}</h5>
          <p>{{ editing ? 'Update merchant configuration' : 'Create a new merchant configuration' }}</p>
        </div>
        <span class="cursor-pointer" style="font-size:1.2rem; color: var(--accent-green);" @click="formVisible = false">&#9660;</span>
      </div>

      <div class="merchant-form-body">
        <div class="row g-3 mb-3">
          <div class="col-md-6">
            <label class="form-label">Name *</label>
            <input v-model="form.name" class="form-control" placeholder="e.g., Demo Brand" required />
          </div>
          <div class="col-md-6">
            <label class="form-label">Network *</label>
            <select v-model="form.network" class="form-select">
              <option value="" disabled>Select Network</option>
              <option value="awin">AWIN</option>
              <option value="cj">CJ</option>
              <option value="impact">Impact</option>
              <option value="webgains">Webgains</option>
            </select>
          </div>
        </div>

        <div v-if="form.network === 'webgains'" class="mb-3">
          <label class="form-label">Merchant ID</label>
          <input v-model="form.advertiser_id" class="form-control" placeholder="e.g., 294460" autocomplete="off" />
          <div class="form-text">
            Webgains Platform API merchant id (used in /merchants/{id}/…). When set here, it is used instead of WEBGAINS_MERCHANT_ID from backend .env. Leave empty to use only the env value.
          </div>
        </div>

        <div v-if="form.network !== 'webgains'" class="mb-3">
          <label class="form-label">Advertiser ID</label>
          <input v-model="form.advertiser_id" class="form-control" placeholder="e.g., 12345" />
          <div class="form-text">AWIN: Your Advertiser ID (brand) for transactions &amp; performance. Impact: Account SID goes in API Key below.</div>
        </div>

        <div class="mb-3">
          <label class="form-label">{{ form.network === 'impact' ? 'Account SID' : form.network === 'webgains' ? 'Client ID' : 'API Key' }}</label>
          <input v-model="form.api_key" class="form-control" :placeholder="editing ? 'Leave blank to keep current' : 'Enter API key'" />
          <div class="form-text">
            <template v-if="form.network === 'awin'">AWIN API bearer token (from your AWIN account).</template>
            <template v-else-if="form.network === 'impact'">Impact Account SID.</template>
            <template v-else-if="form.network === 'webgains'">Webgains OAuth Client ID.</template>
            <template v-else>CJ: brand API key.</template>
          </div>
        </div>

        <div v-if="form.network === 'impact' || form.network === 'webgains'" class="mb-3">
          <label class="form-label">{{ form.network === 'webgains' ? 'Client Secret' : 'Auth Token' }}</label>
          <input v-model="form.api_token" class="form-control" :placeholder="editing ? 'Leave blank to keep current' : 'Enter auth token'" />
          <div class="form-text">
            {{ form.network === 'webgains' ? 'Webgains OAuth Client Secret (username/password come from backend env vars).' : 'Impact Auth Token (paired with Account SID above).' }}
          </div>
        </div>

        <div v-if="form.network === 'webgains'" class="mb-3">
          <label class="form-label">Program ID(s)</label>
          <input v-model="form.publisher_id" class="form-control" placeholder="e.g., 12345 or 11111,22222" autocomplete="off" />
          <div class="form-text">
            Comma-separated Program / Campaign IDs from the Webgains advertiser portal (sent as program_ids[]). If the portal only shows one number for the brand (same as merchant id), you can still enter it here. Optional if WEBGAINS_PROGRAM_IDS is set in backend .env instead.
          </div>
        </div>

        <template v-if="form.network === 'cj'">
          <div class="fees-section-header">
            <h6>CJ credentials (for scraping)</h6>
            <p>Stored per merchant; cron will login and scrape separately for each.</p>
          </div>
          <div class="row g-3 mb-3">
            <div class="col-md-6">
              <label class="form-label">Account name</label>
              <input v-model="form.cj_account_name" class="form-control" placeholder="CJ login account name" />
            </div>
            <div class="col-md-6">
              <label class="form-label">Password</label>
              <input v-model="form.cj_password" type="password" class="form-control" placeholder="CJ login password" autocomplete="off" />
            </div>
          </div>
        </template>

        <div class="mb-3">
          <label class="form-label">Fetch Start Date</label>
          <input v-model="form.fetch_start_date" type="date" class="form-control" />
          <div class="form-text">Start date for automatic daily cron fetch. Data is fetched from this date until today. Leave empty for manual range.</div>
        </div>

        <div class="row g-3 mb-3">
          <div class="col-md-6">
            <label class="form-label">Timezone</label>
            <input v-model="form.timezone" class="form-control" placeholder="UTC" />
          </div>
          <div class="col-md-6">
            <label class="form-label">Currency</label>
            <select v-model="form.currency" class="form-select">
              <option value="">Select Currency</option>
              <option value="USD">USD</option>
              <option value="EUR">EUR</option>
              <option value="DKK">DKK</option>
              <option value="GBP">GBP</option>
              <option value="AUD">AUD</option>
            </select>
          </div>
        </div>

        <!-- Fees & Commission Section -->
        <div class="fees-section-header">
          <h6>Fees &amp; Commission</h6>
          <p>(Όλα προαιρετικά)</p>
        </div>

        <div class="row g-3 mb-3">
          <div class="col-md-6">
            <label class="form-label">Network Fee</label>
            <input v-model.number="form.network_fee" type="number" step="0.01" class="form-control" />
          </div>
          <div class="col-md-6">
            <label class="form-label">Monthly Fee</label>
            <input v-model.number="form.monthly_fee" type="number" step="0.01" class="form-control" />
          </div>
        </div>

        <div class="row g-3 mb-3">
          <div class="col-md-4">
            <label class="form-label">Commission Type</label>
            <select v-model="form.commission_type" class="form-select">
              <option value="">—</option>
              <option value="percentage">Percentage</option>
              <option value="fixed">Fixed</option>
              <option value="tiered">Tiered</option>
            </select>
          </div>
          <div class="col-md-4">
            <label class="form-label">Commission Rate (%)</label>
            <input v-model.number="form.commission_rate" type="number" step="0.01" class="form-control" />
          </div>
          <div class="col-md-4">
            <label class="form-label">Basket Rate (%)</label>
            <input v-model.number="form.basket_rate" type="number" step="0.01" class="form-control" />
          </div>
        </div>

        <div class="row g-3 mb-4">
          <div class="col-md-4">
            <label class="form-label">Impact Commission Volume (monthly)</label>
            <input v-model.number="form.impact_commission_volume" type="number" step="0.01" class="form-control" />
          </div>
          <div class="col-md-4">
            <label class="form-label">Impact Override Rate (%)</label>
            <input v-model.number="form.impact_override_rate" type="number" step="0.01" class="form-control" />
          </div>
          <div class="col-md-4">
            <label class="form-label">Report Network Commission (%)</label>
            <input v-model.number="form.report_network_commission" type="number" step="0.01" class="form-control" />
          </div>
        </div>

        <div class="d-flex justify-content-between">
          <button class="btn btn-outline-secondary" @click="formVisible = false">Cancel</button>
          <button class="btn btn-add-merchant" :disabled="saving" @click="save">
            {{ saving ? 'Saving...' : (editing ? 'Update Merchant' : '&#10133; Create Merchant') }}
          </button>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, onMounted, watch } from 'vue'
import { api } from '../api'

const props = defineProps({
  showAdd: { type: Boolean, default: false },
})
const emit = defineEmits(['message', 'refresh', 'added'])

const merchants = ref([])
const loading = ref(false)
const formVisible = ref(false)
const editing = ref(null)
const saving = ref(false)

const defaultForm = () => ({
  name: '', network: '', advertiser_id: '', publisher_id: '', timezone: 'UTC', api_key: '', api_token: '',
  commission_rate: null, fetch_start_date: '', currency: '',
  network_fee: null, monthly_fee: null, commission_type: '',
  basket_rate: null, impact_commission_volume: null,
  impact_override_rate: null, report_network_commission: null,
  cj_account_name: '', cj_password: '',
})

const form = ref(defaultForm())

watch(() => props.showAdd, (val) => {
  if (val) showForm(null)
})

function showAddForm() { showForm(null) }

async function showForm(m) {
  editing.value = m
  if (m) {
    try {
      const r = await api.merchant(m.id)
      const full = (r.success && r.data) ? r.data : m
      form.value = {
        name: full.name || '', network: full.network || '', advertiser_id: full.advertiser_id || '', publisher_id: full.publisher_id || '',
        timezone: full.timezone || 'UTC', api_key: '', api_token: '', commission_rate: full.commission_rate ?? null,
        fetch_start_date: full.fetch_start_date || '', currency: full.currency || '',
        network_fee: full.network_fee ?? null, monthly_fee: full.monthly_fee ?? null,
        commission_type: full.commission_type || '', basket_rate: full.basket_rate ?? null,
        impact_commission_volume: full.impact_commission_volume ?? null,
        impact_override_rate: full.impact_override_rate ?? null,
        report_network_commission: full.report_network_commission ?? null,
        cj_account_name: full.cj_account_name || '', cj_password: '',
      }
    } catch (_) {
      form.value = {
        name: m.name || '', network: m.network || '', advertiser_id: m.advertiser_id || '', publisher_id: m.publisher_id || '',
        timezone: m.timezone || 'UTC', api_key: '', api_token: '', commission_rate: m.commission_rate ?? null,
        fetch_start_date: m.fetch_start_date || '', currency: m.currency || '',
        network_fee: m.network_fee ?? null, monthly_fee: m.monthly_fee ?? null,
        commission_type: m.commission_type || '', basket_rate: m.basket_rate ?? null,
        impact_commission_volume: m.impact_commission_volume ?? null,
        impact_override_rate: m.impact_override_rate ?? null,
        report_network_commission: m.report_network_commission ?? null,
        cj_account_name: '', cj_password: '',
      }
    }
  } else {
    form.value = defaultForm()
  }
  formVisible.value = true
}

async function save() {
  saving.value = true
  try {
    const body = { ...form.value }
    if (!body.api_key) delete body.api_key
    if (!body.api_token) delete body.api_token
    if (!body.cj_password) delete body.cj_password
    Object.keys(body).forEach(k => {
      if (body[k] === null || body[k] === '') delete body[k]
    })
    if (!body.name || !body.network) {
      emit('message', 'Name and Network are required', 'warning')
      saving.value = false
      return
    }
    if (editing.value) {
      await api.updateMerchant(editing.value.id, body)
      emit('message', 'Merchant updated', 'success')
    } else {
      await api.createMerchant(body)
      emit('message', 'Merchant created', 'success')
    }
    formVisible.value = false
    emit('added')
    load()
    emit('refresh')
  } catch (e) {
    emit('message', e.message || 'Save failed', 'danger')
  } finally {
    saving.value = false
  }
}

async function load() {
  loading.value = true
  try {
    const r = await api.merchants()
    if (r.success) merchants.value = r.data || []
  } catch (e) {
    emit('message', e.message || 'Could not load merchants', 'danger')
  } finally {
    loading.value = false
  }
}

defineExpose({ showAddForm })
onMounted(load)
</script>
