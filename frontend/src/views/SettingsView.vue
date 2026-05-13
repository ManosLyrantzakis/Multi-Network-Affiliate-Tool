<template>
  <div>
    <h1>Settings</h1>
    <p class="text-muted">Application and environment configuration.</p>
    <div class="card card-body">
      <p>Schedule: daily sync at {{ scheduleTime }} UTC, incremental every {{ incrementalHours }}h. Budget limits: AWIN 30, CJ 60, Impact 45 days.</p>
    </div>
  </div>
</template>

<script setup>
const scheduleTime = '02:00'
const incrementalHours = 6
</script>
