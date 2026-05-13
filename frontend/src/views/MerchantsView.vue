<template>
  <div>
    <h1>Merchants</h1>
    <div class="d-flex justify-content-between align-items-center mb-3">
      <span></span>
      <router-link class="btn btn-primary" to="/merchants/new">Add Merchant</router-link>
    </div>
    <table class="table table-striped table-hover">
      <thead>
        <tr>
          <th>Name</th>
          <th>Network</th>
          <th>Advertiser ID</th>
          <th>Timezone</th>
          <th>Actions</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="m in merchants" :key="m.id">
          <td>{{ m.name }}</td>
          <td><span class="badge bg-secondary">{{ m.network }}</span></td>
          <td>{{ m.advertiser_id || '-' }}</td>
          <td>{{ m.timezone }}</td>
          <td>
            <router-link :to="`/merchants/${m.id}/edit`" class="btn btn-sm btn-outline-primary">Edit</router-link>
          </td>
        </tr>
      </tbody>
    </table>
  </div>
</template>

<script setup>
import { ref, onMounted } from 'vue'
import { api } from '../api'
import { useAppStore } from '../stores/app'

const appStore = useAppStore()
const merchants = ref([])

async function load() {
  try {
    const r = await api.merchants()
    if (r.success) merchants.value = r.data || []
  } catch (_) {}
}

onMounted(() => {
  load()
  appStore.loadMerchants()
})
</script>
