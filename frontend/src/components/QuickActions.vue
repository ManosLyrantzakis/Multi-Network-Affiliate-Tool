<template>
  <div class="quick-actions-section">
    <div class="quick-actions-card">
      <div class="quick-actions-label">Quick Actions</div>
      <button class="btn-qa btn-qa-green" :disabled="syncing" @click="$emit('add-merchant')">
        &#10133; Add Merchant
      </button>
      <button class="btn-qa btn-qa-blue" :disabled="syncing" @click="$emit('fetch-data')">
        &#128229; Fetch Data
      </button>
    </div>
    <div class="quick-actions-card" style="border-left-color: #6366f1;">
      <div class="quick-actions-label">Analytics</div>
      <button class="btn-qa btn-qa-dark" @click="$emit('go-dashboard')">
        &#128202; Dashboard
      </button>
      <button class="btn-qa btn-qa-gray" @click="$emit('go-performance')">
        &#128200; Performance
      </button>
    </div>
  </div>
</template>

<script setup>
defineProps({
  merchants: { type: Array, default: () => [] },
  syncing: { type: Boolean, default: false },
})
defineEmits(['add-merchant', 'fetch-data', 'go-dashboard', 'go-performance'])
</script>
