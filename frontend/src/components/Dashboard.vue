<template>
  <div>
    <div class="page-title-card">
      <h4 class="page-title">Dashboard</h4>
      <p class="page-subtitle">Overview of your affiliate marketing data</p>
      <div v-if="selectedMerchantId" class="mt-2 d-flex align-items-center gap-2">
        <span class="badge bg-primary">Viewing: {{ selectedMerchantName }}</span>
        <button class="btn btn-sm btn-outline-secondary" @click="$emit('clear-filter')">Show All</button>
      </div>
    </div>

    <!-- Stat Cards -->
    <div class="row g-3 mb-3">
      <div class="col-md-6 col-lg-3">
        <div class="stat-card">
          <div>
            <div class="stat-label">Total Merchants</div>
            <div class="stat-value">{{ totalMerchants }}</div>
          </div>
          <div class="stat-icon">&#128203;</div>
        </div>
      </div>
      <div class="col-md-6 col-lg-3">
        <div class="stat-card blue">
          <div>
            <div class="stat-label">Networks</div>
            <div class="stat-value">{{ networkCount }}</div>
          </div>
          <div class="stat-icon">&#127760;</div>
        </div>
      </div>
      <div class="col-md-6 col-lg-3">
        <div class="stat-card green">
          <div>
            <div class="stat-label">Active</div>
            <div class="stat-value">{{ activeMerchants }}</div>
          </div>
          <div class="stat-icon">&#9989;</div>
        </div>
      </div>
      <div class="col-md-6 col-lg-3">
        <div class="stat-card">
          <div>
            <div class="stat-label">Last Fetch</div>
            <div class="stat-value" style="font-size:0.85rem; font-weight:500; word-break:break-all;">{{ lastFetch }}</div>
          </div>
          <div class="stat-icon">&#128336;</div>
        </div>
      </div>
    </div>

    <!-- Quick Actions + Recent Activity -->
    <div class="row g-3 mb-3">
      <div class="col-lg-5">
        <div class="affilient-card card-green-border" style="padding:1rem 1.25rem;">
          <div class="d-flex justify-content-between align-items-center mb-3">
            <h6 class="mb-0 fw-bold">Quick Actions</h6>
            <span style="font-size:1.1rem;">&#9889;</span>
          </div>
          <div class="d-flex gap-2 flex-wrap">
            <button class="btn btn-sm text-white" style="background:#3b82f6;" @click="$emit('go-merchants')">
              &#128203; Manage Merchants
            </button>
            <button class="btn btn-sm text-white" style="background:#6366f1;" @click="$emit('go-performance')">
              &#128202; View Performance
            </button>
            <button class="btn btn-sm text-white" style="background:#10b981;" @click="$emit('fetch-data')">
              &#128229; Fetch Data
            </button>
          </div>
        </div>
      </div>
      <div class="col-lg-7">
        <div class="affilient-card" style="padding:1rem 1.25rem;">
          <div class="d-flex justify-content-between align-items-center mb-2">
            <h6 class="mb-0 fw-bold">Recent Activity</h6>
            <span style="font-size:1rem;">&#128221;</span>
          </div>
          <div v-if="recentActivity.length === 0" class="text-muted" style="font-size:0.85rem;">
            No recent activity yet.
          </div>
          <div v-else>
            <div v-for="(act, i) in recentActivity" :key="i" class="activity-item">
              <span class="activity-name">{{ act.name }} <span class="text-muted">{{ act.network }}</span></span>
              <span class="activity-time">{{ act.time }}</span>
            </div>
          </div>
        </div>
      </div>
    </div>

    <!-- Merchants by Network -->
    <div class="affilient-card" style="padding:1rem 1.25rem;">
      <div class="d-flex justify-content-between align-items-center mb-3">
        <h6 class="mb-0 fw-bold">Merchants by Network</h6>
        <span style="font-size:1rem;">&#128202;</span>
      </div>
      <div class="network-stats">
        <div class="network-stat-item" v-for="net in networkBreakdown" :key="net.name">
          <div class="network-count">{{ net.count }}</div>
          <div class="network-name">{{ net.name }}</div>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup>
import { computed } from 'vue'

const props = defineProps({
  merchants: { type: Array, default: () => [] },
  stats: { type: Object, default: () => ({}) },
  selectedMerchantId: { type: String, default: '' },
})
defineEmits(['refresh', 'go-merchants', 'go-performance', 'fetch-data', 'clear-filter'])

const selectedMerchantName = computed(() => {
  if (!props.selectedMerchantId) return ''
  const m = props.merchants.find(x => String(x.id) === String(props.selectedMerchantId))
  return m ? `${m.name} (${m.network})` : props.selectedMerchantId
})

const totalMerchants = computed(() => props.merchants.length || props.stats.merchant_count || 0)

const activeMerchants = computed(() => {
  if (props.stats.active_count !== undefined) return props.stats.active_count
  return props.merchants.filter(m => m.status !== 'inactive').length
})

const networkCount = computed(() => {
  const nets = new Set(props.merchants.map(m => (m.network || '').toLowerCase()))
  return nets.size || props.stats.network_count || 0
})

const lastFetch = computed(() => {
  if (props.stats.last_fetch) return props.stats.last_fetch
  return 'N/A'
})

const networkBreakdown = computed(() => {
  const map = {}
  props.merchants.forEach(m => {
    const n = (m.network || 'unknown').toUpperCase()
    map[n] = (map[n] || 0) + 1
  })
  return Object.entries(map).map(([name, count]) => ({ name, count }))
})

const recentActivity = computed(() => {
  if (props.stats.recent_activity && Array.isArray(props.stats.recent_activity)) {
    return props.stats.recent_activity.slice(0, 5).map(a => ({
      name: a.merchant_name || a.name || 'Unknown',
      network: a.network || '',
      time: a.timestamp || a.fetched_at || '',
    }))
  }
  return props.merchants.slice(0, 5).map(m => ({
    name: m.name,
    network: m.network || '',
    time: m.updated_at || m.created_at || '',
  }))
})
</script>
