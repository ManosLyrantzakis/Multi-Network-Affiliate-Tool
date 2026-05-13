<template>
  <div class="app-layout">
    <aside class="sidebar">
      <div class="sidebar-brand">AFFILIENT</div>
      <nav class="sidebar-nav">
        <template v-for="item in navItems" :key="item.id">
          <a
            href="#"
            class="nav-item"
            :class="{ active: isActive(item) }"
            @click.prevent="onNavClick(item)"
          >
            <span class="nav-icon" v-html="item.icon"></span>
            <span class="nav-label">{{ item.label }}</span>
            <span
              v-if="item.children"
              class="nav-expand-arrow"
              :class="{ expanded: expandedMenus[item.id] }"
            >&#9660;</span>
          </a>
          <div
            v-if="item.children"
            class="nav-sub-items"
            :style="{ maxHeight: expandedMenus[item.id] ? (item.children.length * 36) + 'px' : '0px' }"
          >
            <a
              v-for="child in item.children"
              :key="child.id"
              href="#"
              class="nav-sub-item"
              :class="{ active: tab === child.id }"
              @click.prevent="tab = child.id"
            >
              <span class="nav-sub-icon" v-html="child.icon || '&#9679;'"></span>
              <span>{{ child.label }}</span>
            </a>
          </div>
        </template>
      </nav>
    </aside>

    <main class="main-content">
      <Alert v-if="message.text" :type="message.type" @dismiss="message.text = ''">{{ message.text }}</Alert>

      <QuickActions
        v-if="tab === 'home'"
        :merchants="merchants"
        :syncing="syncing"
        @add-merchant="tab = 'merchants'; showAddMerchant = true"
        @fetch-data="showFetchModal = true"
        @go-dashboard="tab = 'dashboard'"
        @go-performance="tab = 'performance-overview'"
      />

      <FetchDataModal
        v-if="showFetchModal"
        :merchants="merchants"
        :loading="syncing"
        @close="showFetchModal = false"
        @sync="runSync"
      />

      <div v-if="syncing" class="fetching-card">
        <h5>Fetching Data...</h5>
        <p class="text-muted mb-0" style="font-size:0.85rem">Initializing...</p>
        <div class="progress-bar-custom">
          <div class="progress-bar-fill" :style="{ width: syncProgress + '%' }"></div>
        </div>
        <p class="text-center text-muted mb-1" style="font-size:0.9rem">{{ syncProgress }}%</p>
        <button class="btn btn-sm btn-outline-secondary" @click="syncing = false">Close</button>
      </div>

      <div class="content-area">
        <Dashboard
          v-if="tab === 'dashboard' || tab === 'home'"
          :merchants="merchants"
          :stats="dashboardStats"
          :selected-merchant-id="appStore.selectedMerchantId"
          @refresh="loadDashboard"
          @clear-filter="appStore.setSelectedMerchant(null); loadDashboard()"
          @go-merchants="tab = 'merchants'"
          @go-performance="tab = 'performance-overview'"
          @fetch-data="showFetchModal = true"
        />

        <Performance
          v-else-if="tab === 'performance-overview'"
          :merchants="merchants"
          :selected-merchant-id="appStore.selectedMerchantId"
        />

        <PerformanceClicks
          v-else-if="tab === 'performance-clicks'"
          :merchants="merchants"
          :selected-merchant-id="appStore.selectedMerchantId"
        />

        <PublisherPerformance
          v-else-if="tab === 'publisher-performance'"
          :merchants="merchants"
          :preset-merchant-id="appStore.selectedMerchantId"
        />

        <TransactionDetails
          v-else-if="tab === 'transaction-details'"
          :merchants="merchants"
          :selected-merchant-id="appStore.selectedMerchantId"
          @message="setMessage"
        />

        <PublisherInformation
          v-else-if="tab === 'publisher-information'"
          :merchants="merchants"
          :preset-merchant-id="appStore.selectedMerchantId"
        />

        <PartnerDailyPerformance
          v-else-if="tab === 'partner-daily'"
          :merchants="merchants"
          :preset-merchant-id="appStore.selectedMerchantId"
        />

        <CJBrandManager
          v-else-if="tab === 'cj'"
          :merchants="merchants"
        />

        <Merchants
          ref="merchantsRef"
          v-else-if="tab === 'merchants'"
          :show-add="showAddMerchant"
          @message="setMessage"
          @refresh="loadMerchants"
          @added="showAddMerchant = false"
        />

        <Settings v-else-if="tab === 'settings'" />

        <Transactions
          v-else-if="tab === 'transactions'"
          :merchants="merchants"
          :selected-merchant-id="appStore.selectedMerchantId"
          @message="setMessage"
        />

        <Validation
          v-else-if="tab === 'validation'"
          :merchants="merchants"
          :selected-merchant-id="appStore.selectedMerchantId"
          @message="setMessage"
        />
      </div>
    </main>
  </div>
</template>

<script setup>
import { ref, reactive, onMounted, watch } from 'vue'
import Dashboard from './components/Dashboard.vue'
import Merchants from './components/Merchants.vue'
import Transactions from './components/Transactions.vue'
import Validation from './components/Validation.vue'
import Performance from './components/Performance.vue'
import PerformanceClicks from './components/PerformanceClicks.vue'
import PublisherPerformance from './components/PublisherPerformance.vue'
import TransactionDetails from './components/TransactionDetails.vue'
import PublisherInformation from './components/PublisherInformation.vue'
import PartnerDailyPerformance from './components/PartnerDailyPerformance.vue'
import CJBrandManager from './components/CJBrandManager.vue'
import Settings from './components/Settings.vue'
import QuickActions from './components/QuickActions.vue'
import FetchDataModal from './components/FetchDataModal.vue'
import Alert from './components/Alert.vue'
import { api } from './api'
import { useAppStore } from './stores/app'

const appStore = useAppStore()
const tab = ref('home')
const message = ref({ text: '', type: 'info' })
const merchants = ref([])
const dashboardStats = ref({})
const syncing = ref(false)
const syncProgress = ref(0)
const showFetchModal = ref(false)
const showAddMerchant = ref(false)

const expandedMenus = reactive({ performance: false })

const perfSubItems = [
  { id: 'performance-overview', label: 'Overview', icon: '&#128202;' },
  { id: 'performance-clicks', label: 'Clicks', icon: '&#128433;' },
  { id: 'publisher-performance', label: 'Publisher Performance', icon: '&#128101;' },
  { id: 'transaction-details', label: 'Transaction Details', icon: '&#128196;' },
  { id: 'validation', label: 'Validation (Approve/Decline)', icon: '&#9989;' },
  { id: 'publisher-information', label: 'Publisher Information', icon: '&#128195;' },
  { id: 'partner-daily', label: 'Partner Daily Performance', icon: '&#128197;' },
]

const navItems = [
  { id: 'home', label: 'Home', icon: '<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" fill="currentColor" viewBox="0 0 16 16"><path d="M8.707 1.5a1 1 0 0 0-1.414 0L.646 8.146a.5.5 0 0 0 .708.708L2 8.207V13.5A1.5 1.5 0 0 0 3.5 15h9a1.5 1.5 0 0 0 1.5-1.5V8.207l.646.647a.5.5 0 0 0 .708-.708L13 5.793V2.5a.5.5 0 0 0-.5-.5h-1a.5.5 0 0 0-.5.5v1.293L8.707 1.5Z"/></svg>' },
  { id: 'dashboard', label: 'Dashboard', icon: '<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" fill="currentColor" viewBox="0 0 16 16"><path d="M0 1.5A1.5 1.5 0 0 1 1.5 0h2A1.5 1.5 0 0 1 5 1.5v2A1.5 1.5 0 0 1 3.5 5h-2A1.5 1.5 0 0 1 0 3.5v-2zM1.5 1a.5.5 0 0 0-.5.5v2a.5.5 0 0 0 .5.5h2a.5.5 0 0 0 .5-.5v-2a.5.5 0 0 0-.5-.5h-2zM0 8a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2H2a2 2 0 0 1-2-2V8zm1 3v2a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-2H1zm14-1V8a1 1 0 0 0-1-1H2a1 1 0 0 0-1 1v2h14zM2 8.5a.5.5 0 0 1 .5-.5h9a.5.5 0 0 1 0 1h-9a.5.5 0 0 1-.5-.5zm0 4a.5.5 0 0 1 .5-.5h6a.5.5 0 0 1 0 1h-6a.5.5 0 0 1-.5-.5z"/></svg>' },
  { id: 'performance', label: 'Performance', children: perfSubItems, icon: '<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" fill="currentColor" viewBox="0 0 16 16"><path d="M4 11H2v3h2v-3zm5-4H7v7h2V7zm5-5v12h-2V2h2zm-2-1a1 1 0 0 0-1 1v12a1 1 0 0 0 1 1h2a1 1 0 0 0 1-1V2a1 1 0 0 0-1-1h-2zM6 7a1 1 0 0 1 1-1h2a1 1 0 0 1 1 1v7a1 1 0 0 1-1 1H7a1 1 0 0 1-1-1V7zm-5 4a1 1 0 0 1 1-1h2a1 1 0 0 1 1 1v3a1 1 0 0 1-1 1H2a1 1 0 0 1-1-1v-3z"/></svg>' },
  { id: 'cj', label: 'CJ Brand Manager', icon: '<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" fill="currentColor" viewBox="0 0 16 16"><path d="M3 14s-1 0-1-1 1-4 6-4 6 3 6 4-1 1-1 1H3zm5-6a3 3 0 1 0 0-6 3 3 0 0 0 0 6z"/></svg>' },
  { id: 'merchants', label: 'Merchants', icon: '<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" fill="currentColor" viewBox="0 0 16 16"><path d="M2.97 1.35A1 1 0 0 1 3.73 1h8.54a1 1 0 0 1 .76.35l2.609 3.044A1.5 1.5 0 0 1 16 5.37v.255a2.375 2.375 0 0 1-4.25 1.458A2.371 2.371 0 0 1 9.875 8 2.37 2.37 0 0 1 8 7.083 2.37 2.37 0 0 1 6.125 8a2.37 2.37 0 0 1-1.875-.917A2.375 2.375 0 0 1 0 5.625V5.37a1.5 1.5 0 0 1 .361-.976l2.61-3.045zm1.78 4.275a1.375 1.375 0 0 0 2.75 0 .5.5 0 0 1 1 0 1.375 1.375 0 0 0 2.75 0 .5.5 0 0 1 1 0 1.375 1.375 0 1 0 2.75 0V5.37a.5.5 0 0 0-.12-.325L12.27 2H3.73L1.12 5.045A.5.5 0 0 0 1 5.37v.255a1.375 1.375 0 0 0 2.75 0 .5.5 0 0 1 1 0zM1.5 8.5A.5.5 0 0 1 2 9v6h1v-5a1 1 0 0 1 1-1h3a1 1 0 0 1 1 1v5h6V9a.5.5 0 0 1 1 0v6h.5a.5.5 0 0 1 0 1H.5a.5.5 0 0 1 0-1H1V9a.5.5 0 0 1 .5-.5zM4 15h3v-5H4v5z"/></svg>' },
  { id: 'settings', label: 'Settings', icon: '<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" fill="currentColor" viewBox="0 0 16 16"><path d="M8 4.754a3.246 3.246 0 1 0 0 6.492 3.246 3.246 0 0 0 0-6.492zM5.754 8a2.246 2.246 0 1 1 4.492 0 2.246 2.246 0 0 1-4.492 0z"/><path d="M9.796 1.343c-.527-1.79-3.065-1.79-3.592 0l-.094.319a.873.873 0 0 1-1.255.52l-.292-.16c-1.64-.892-3.433.902-2.54 2.541l.159.292a.873.873 0 0 1-.52 1.255l-.319.094c-1.79.527-1.79 3.065 0 3.592l.319.094a.873.873 0 0 1 .52 1.255l-.16.292c-.892 1.64.901 3.434 2.541 2.54l.292-.159a.873.873 0 0 1 1.255.52l.094.319c.527 1.79 3.065 1.79 3.592 0l.094-.319a.873.873 0 0 1 1.255-.52l.292.16c1.64.893 3.434-.902 2.54-2.541l-.159-.292a.873.873 0 0 1 .52-1.255l.319-.094c1.79-.527 1.79-3.065 0-3.592l-.319-.094a.873.873 0 0 1-.52-1.255l.16-.292c.893-1.64-.902-3.433-2.541-2.54l-.292.159a.873.873 0 0 1-1.255-.52l-.094-.319z"/></svg>' },
]

const perfTabIds = perfSubItems.map(c => c.id)

function isActive(item) {
  if (item.children) {
    return perfTabIds.includes(tab.value)
  }
  return tab.value === item.id
}

function onNavClick(item) {
  if (item.children) {
    expandedMenus[item.id] = !expandedMenus[item.id]
    if (!perfTabIds.includes(tab.value)) {
      tab.value = item.children[0].id
    }
  } else {
    tab.value = item.id
  }
}

watch(tab, (val) => {
  if (perfTabIds.includes(val)) {
    expandedMenus.performance = true
  }
  showAddMerchant.value = false
})

function setMessage(text, type = 'info') {
  message.value = { text, type }
}

async function loadMerchants() {
  console.log('[App] loadMerchants called')
  try {
    const r = await api.merchants()
    console.log('[App] loadMerchants result:', r)
    if (r.success && r.data) merchants.value = r.data
    else if (!r.success && r.error) setMessage(r.error, 'danger')
  } catch (e) {
    console.error('[App] loadMerchants error:', e)
    setMessage(e.message || 'Could not load merchants. Is the backend running on port 5001?', 'danger')
  }
}

async function loadDashboard() {
  console.log('[App] loadDashboard called')
  const mid = appStore.selectedMerchantId || ''
  const params = mid ? { merchant_id: mid } : {}
  try {
    const [m, d] = await Promise.all([
      api.merchants(),
      api.dashboard(params).catch((e) => { console.error('[App] dashboard error:', e); return null })
    ])
    console.log('[App] loadDashboard merchants:', m, 'dashboard:', d, 'filter:', mid || 'all')
    if (m.success) merchants.value = m.data || []
    if (d && d.success && d.data) {
      dashboardStats.value = d.data
    } else if (d && d.data == null && typeof d.merchant_count === 'number') {
      // Παλιά flat μορφή χωρίς apiResponse (backward compat)
      dashboardStats.value = d
    } else {
      const p = await api.performance(params).catch(() => ({}))
      if (p.success) {
        dashboardStats.value = { ...p.data, merchant_count: mid ? 1 : (m.data || []).length }
      }
    }
  } catch (e) { console.error('[App] loadDashboard error:', e) }
}

async function runSync(payload) {
  syncing.value = true
  syncProgress.value = 0
  try {
    const body = payload || { start_date: defaultStart(), end_date: defaultEnd() }
    const r = await api.sync(body)
    syncProgress.value = 100
    if (body.merchant_id) appStore.setSelectedMerchant(body.merchant_id)
    onSyncComplete(r)
    if (payload) showFetchModal.value = false
  } catch (e) {
    setMessage(e.message || 'Sync failed', 'danger')
    if (payload) showFetchModal.value = false
  } finally {
    setTimeout(() => { syncing.value = false; syncProgress.value = 0 }, 1500)
  }
}

function defaultStart() {
  return new Date(Date.now() - 7 * 864e5).toISOString().slice(0, 10)
}
function defaultEnd() {
  return new Date().toISOString().slice(0, 10)
}

function onSyncComplete(r) {
  setMessage(`Synced ${r?.data?.transaction_count ?? 0} transactions`, 'success')
  loadDashboard()
}

onMounted(() => {
  loadMerchants()
  loadDashboard()
})
</script>
