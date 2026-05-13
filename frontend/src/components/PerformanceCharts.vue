<template>
  <div class="gap-grid-2 mb-3">
    <!-- Daily Trend + By Network Charts (larger) -->
    <div class="chart-card chart-card-lg">
      <h5 class="mb-2">Daily Trend</h5>
      <div class="chart-container" style="position:relative; height:280px;">
        <Line v-if="dailyChartData.labels.length" :data="dailyChartData" :options="lineOptions" />
        <div v-else class="d-flex align-items-center justify-content-center h-100 text-muted" style="font-size:0.85rem;">
          No daily data available
        </div>
      </div>
    </div>

    <div class="chart-card chart-card-lg">
      <h5 class="mb-2">By Network</h5>
      <div class="chart-container" style="position:relative; height:280px;">
        <Bar v-if="networkChartData.labels.length" :data="networkChartData" :options="barOptions" />
        <div v-else class="d-flex align-items-center justify-content-center h-100 text-muted" style="font-size:0.85rem;">
          No network data available
        </div>
      </div>
    </div>
  </div>
</template>

<script setup>
import { computed } from 'vue'
import { Line, Bar } from 'vue-chartjs'
import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  BarElement,
  Title,
  Tooltip,
  Legend,
  Filler,
} from 'chart.js'

ChartJS.register(CategoryScale, LinearScale, PointElement, LineElement, BarElement, Title, Tooltip, Legend, Filler)

const props = defineProps({
  stats: { type: Object, default: () => ({}) },
  transactions: { type: Array, default: () => [] },
})

const dailyChartData = computed(() => {
  const daily = {}
  props.transactions.forEach(t => {
    const d = (t.transaction_datetime_utc || t.created_at || '').slice(0, 10)
    if (!d) return
    if (!daily[d]) daily[d] = { sales: 0, commission: 0, count: 0 }
    daily[d].sales += Number(t.amount || 0)
    daily[d].commission += Number(t.commission || 0)
    daily[d].count += 1
  })
  const sorted = Object.keys(daily).sort()
  return {
    labels: sorted,
    datasets: [
      {
        label: 'Sales',
        data: sorted.map(d => daily[d].sales),
        borderColor: '#3b82f6',
        backgroundColor: 'rgba(59,130,246,0.1)',
        fill: true,
        tension: 0.3,
        yAxisID: 'y',
      },
      {
        label: 'Commission',
        data: sorted.map(d => daily[d].commission),
        borderColor: '#10b981',
        backgroundColor: 'rgba(16,185,129,0.1)',
        fill: true,
        tension: 0.3,
        yAxisID: 'y',
      },
      {
        label: 'Transactions',
        data: sorted.map(d => daily[d].count),
        borderColor: '#f59e0b',
        backgroundColor: 'rgba(245,158,11,0.1)',
        fill: false,
        tension: 0.3,
        yAxisID: 'y1',
      },
    ],
  }
})

const lineOptions = {
  responsive: true,
  maintainAspectRatio: false,
  interaction: { mode: 'index', intersect: false },
  plugins: {
    legend: { position: 'top', labels: { usePointStyle: true, boxWidth: 8, font: { size: 11 } } },
  },
  scales: {
    y: {
      type: 'linear',
      position: 'left',
      ticks: { font: { size: 10 }, callback: v => '$' + v.toLocaleString() },
      grid: { color: '#f1f5f9' },
    },
    y1: {
      type: 'linear',
      position: 'right',
      grid: { drawOnChartArea: false },
      ticks: { font: { size: 10 } },
    },
    x: {
      ticks: { font: { size: 9 }, maxRotation: 45 },
      grid: { color: '#f1f5f9' },
    },
  },
}

const networkChartData = computed(() => {
  const nets = {}
  props.transactions.forEach(t => {
    const n = (t.network || 'other').toUpperCase()
    if (!nets[n]) nets[n] = { sales: 0, commission: 0, count: 0 }
    nets[n].sales += Number(t.amount || 0)
    nets[n].commission += Number(t.commission || 0)
    nets[n].count += 1
  })
  const labels = Object.keys(nets)
  return {
    labels,
    datasets: [
      {
        label: 'Sales',
        data: labels.map(n => nets[n].sales),
        backgroundColor: '#3b82f6',
      },
      {
        label: 'Commission',
        data: labels.map(n => nets[n].commission),
        backgroundColor: '#10b981',
      },
      {
        label: 'Transactions',
        data: labels.map(n => nets[n].count),
        backgroundColor: '#f59e0b',
      },
    ],
  }
})

const barOptions = {
  responsive: true,
  maintainAspectRatio: false,
  plugins: {
    legend: { position: 'top', labels: { usePointStyle: true, boxWidth: 8, font: { size: 11 } } },
  },
  scales: {
    y: {
      ticks: { font: { size: 10 }, callback: v => v.toLocaleString() },
      grid: { color: '#f1f5f9' },
    },
    x: {
      ticks: { font: { size: 11 } },
      grid: { display: false },
    },
  },
}
</script>
