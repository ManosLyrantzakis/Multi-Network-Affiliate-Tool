import { createRouter, createWebHistory } from 'vue-router'

const routes = [
  { path: '/', redirect: '/dashboard' },
  { path: '/dashboard', name: 'Dashboard', component: () => import('../views/DashboardView.vue') },
  { path: '/merchants', name: 'Merchants', component: () => import('../views/MerchantsView.vue') },
  { path: '/merchants/new', name: 'MerchantNew', component: () => import('../views/MerchantEditView.vue'), props: { isNew: true } },
  { path: '/merchants/:id/edit', name: 'MerchantEdit', component: () => import('../views/MerchantEditView.vue'), props: true },
  { path: '/transactions', name: 'Transactions', component: () => import('../views/TransactionsView.vue') },
  { path: '/validation', name: 'Validation', component: () => import('../views/ValidationView.vue') },
  { path: '/performance', name: 'Performance', component: () => import('../views/PerformanceView.vue') },
  { path: '/reports/transactions', name: 'ReportsTransactions', component: () => import('../views/TransactionsView.vue') },
  { path: '/settings', name: 'Settings', component: () => import('../views/SettingsView.vue') },
  { path: '/presets', name: 'Presets', component: () => import('../views/PlaceholderView.vue'), props: { title: 'Presets' } },
  { path: '/mapping', name: 'Mapping', component: () => import('../views/PlaceholderView.vue'), props: { title: 'Mapping' } },
  { path: '/runs', name: 'Runs', component: () => import('../views/PlaceholderView.vue'), props: { title: 'Runs' } },
  { path: '/cj-scraper', name: 'CjScraper', component: () => import('../views/PlaceholderView.vue'), props: { title: 'CJ Scraper' } },
]

const router = createRouter({
  history: createWebHistory(),
  routes,
})

export default router
