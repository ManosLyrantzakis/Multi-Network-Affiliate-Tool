<template>
  <div>
    <div class="page-title-card">
      <h4 class="page-title">Settings</h4>
      <p class="page-subtitle">Application preferences and configuration</p>
    </div>

    <div class="row g-3">
      <div class="col-md-6">
        <div class="affilient-card card-green-border" style="padding:1.25rem;">
          <h6 class="fw-bold mb-3">&#9881; General Settings</h6>
          <div class="mb-3">
            <label class="form-label" style="font-size:0.85rem;">Backend URL</label>
            <input v-model="backendUrl" class="form-control" readonly style="background:#f8fafc;" />
          </div>
          <div class="mb-3">
            <label class="form-label" style="font-size:0.85rem;">Default Timezone</label>
            <select v-model="timezone" class="form-select">
              <option value="UTC">UTC</option>
              <option value="US/Pacific">US/Pacific</option>
              <option value="US/Eastern">US/Eastern</option>
              <option value="Europe/London">Europe/London</option>
              <option value="Europe/Athens">Europe/Athens</option>
            </select>
          </div>
          <div class="mb-3">
            <label class="form-label" style="font-size:0.85rem;">Default Currency</label>
            <select v-model="currency" class="form-select">
              <option value="USD">USD</option>
              <option value="EUR">EUR</option>
              <option value="GBP">GBP</option>
            </select>
          </div>
        </div>
      </div>

      <div class="col-md-6">
        <div class="affilient-card card-blue-border" style="padding:1.25rem;">
          <h6 class="fw-bold mb-3">&#128295; System Info</h6>
          <div class="mb-2 d-flex justify-content-between" style="font-size:0.85rem;">
            <span class="text-muted">Backend</span>
            <span>Node.js on port 5001</span>
          </div>
          <div class="mb-2 d-flex justify-content-between" style="font-size:0.85rem;">
            <span class="text-muted">Frontend</span>
            <span>Vue 3 + Vite</span>
          </div>
          <div class="mb-2 d-flex justify-content-between" style="font-size:0.85rem;">
            <span class="text-muted">API Status</span>
            <span :class="apiStatus === 'Connected' ? 'text-success' : 'text-danger'">{{ apiStatus }}</span>
          </div>
          <div class="mb-2 d-flex justify-content-between" style="font-size:0.85rem;">
            <span class="text-muted">Version</span>
            <span>1.0.0</span>
          </div>
          <button class="btn btn-update btn-sm mt-2" @click="checkHealth">&#128269; Check Connection</button>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, onMounted } from 'vue'
import { api } from '../api'

const backendUrl = ref('http://127.0.0.1:5001')
const timezone = ref('UTC')
const currency = ref('USD')
const apiStatus = ref('Checking...')

async function checkHealth() {
  apiStatus.value = 'Checking...'
  try {
    await api.health()
    apiStatus.value = 'Connected'
  } catch {
    apiStatus.value = 'Disconnected'
  }
}

onMounted(checkHealth)
</script>
