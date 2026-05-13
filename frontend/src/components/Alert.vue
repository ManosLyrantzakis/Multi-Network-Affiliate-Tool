<template>
  <div class="alert" :class="`alert-${type}`" role="alert">
    <slot />
    <button v-if="dismissible" type="button" class="btn-close float-end" aria-label="Close" @click="$emit('dismiss')"></button>
  </div>
</template>

<script setup>
defineProps({ type: { type: String, default: 'info' }, dismissible: { type: Boolean, default: true } })
defineEmits(['dismiss'])
</script>
