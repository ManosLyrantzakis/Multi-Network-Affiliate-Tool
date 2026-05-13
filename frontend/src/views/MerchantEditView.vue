<template>
  <div>
    <h1>{{ isNew ? 'Add Merchant' : 'Edit Merchant' }}</h1>
    <form @submit.prevent="save" class="card card-body">
      <div class="mb-2">
        <label class="form-label">Name</label>
        <input v-model="form.name" class="form-control" required />
      </div>
      <div class="mb-2">
        <label class="form-label">Network</label>
        <select v-model="form.network" class="form-select">
          <option value="awin">AWIN</option>
          <option value="cj">CJ</option>
          <option value="impact">Impact</option>
        </select>
      </div>
      <div class="mb-2">
        <label class="form-label">Advertiser ID</label>
        <input v-model="form.advertiser_id" class="form-control" placeholder="Optional" />
      </div>
      <div class="mb-2">
        <label class="form-label">Timezone</label>
        <input v-model="form.timezone" class="form-control" />
      </div>
      <div class="mb-2">
        <label class="form-label">API Key / Token</label>
        <input v-model="form.api_key" type="password" class="form-control" :placeholder="isNew ? '' : 'Leave blank to keep'" />
      </div>
      <div class="mb-2">
        <label class="form-label">Commission Rate (%)</label>
        <input v-model.number="form.commission_rate" type="number" step="0.01" class="form-control" />
      </div>
      <div>
        <button type="submit" class="btn btn-primary" :disabled="saving">{{ saving ? 'Saving...' : 'Save' }}</button>
        <router-link to="/merchants" class="btn btn-secondary ms-2">Cancel</router-link>
      </div>
    </form>
  </div>
</template>

<script setup>
import { ref, onMounted, computed } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { api } from '../api'
import { useAppStore } from '../stores/app'

const props = defineProps({ isNew: Boolean, id: String })
const route = useRoute()
const router = useRouter()
const appStore = useAppStore()
const saving = ref(false)
const form = ref({
  name: '', network: 'impact', advertiser_id: '', timezone: 'UTC', api_key: '', commission_rate: 0,
})

const isNew = computed(() => props.isNew || route.path.endsWith('/new'))
const merchantId = computed(() => props.id || route.params.id)

async function save() {
  saving.value = true
  try {
    const body = { ...form.value }
    if (!body.api_key) delete body.api_key
    if (isNew.value) {
      await api.createMerchant(body)
      appStore.setMessage('Merchant created', 'success')
    } else {
      await api.updateMerchant(merchantId.value, body)
      appStore.setMessage('Merchant updated', 'success')
    }
    appStore.loadMerchants()
    router.push('/merchants')
  } catch (e) {
    appStore.setMessage(e.message || 'Save failed', 'danger')
  } finally {
    saving.value = false
  }
}

onMounted(async () => {
  if (!isNew.value && merchantId.value) {
    try {
      const r = await api.merchant(merchantId.value)
      if (r.success && r.data) {
        const m = r.data
        form.value = { name: m.name, network: m.network, advertiser_id: m.advertiser_id || '', timezone: m.timezone || 'UTC', api_key: '', commission_rate: m.commission_rate ?? 0 }
      }
    } catch (_) {}
  }
})
</script>
