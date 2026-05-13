<template>
  <div>
    <h1>{{ title }}</h1>
    <p class="text-muted">This section is available; full implementation follows the same patterns as the rest of the app.</p>
  </div>
</template>

<script setup>
defineProps({ title: { type: String, default: 'Page' } })
</script>
