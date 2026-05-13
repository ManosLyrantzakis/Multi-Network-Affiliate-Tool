import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import { api } from '../api'

export const useAppStore = defineStore('app', () => {
  const merchants = ref([])
  const message = ref({ text: '', type: 'info' })
  const globalFilters = ref({ merchant_id: '', network: '' })
  /** Merchant selected by last fetch – all views filter by this until next fetch. */
  const selectedMerchantId = ref('')

  const merchantsList = computed(() => merchants.value)

  function setMessage(text, type = 'info') {
    message.value = { text, type }
  }

  function clearMessage() {
    message.value = { text: '', type: 'info' }
  }

  function setSelectedMerchant(id) {
    selectedMerchantId.value = id ? String(id) : ''
  }

  async function loadMerchants() {
    try {
      const r = await api.merchants()
      if (r.success && r.data) merchants.value = r.data
    } catch (_) {}
  }

  return {
    merchants: merchantsList,
    message: computed(() => message.value),
    globalFilters,
    selectedMerchantId: computed(() => selectedMerchantId.value),
    setMessage,
    clearMessage,
    setSelectedMerchant,
    loadMerchants,
  }
})
