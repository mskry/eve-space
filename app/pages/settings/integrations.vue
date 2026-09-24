<script setup lang="ts">
definePageMeta({ platformAudience: 'public', title: 'Settings' })
useHead({ title: 'Settings // EVE Space' })
</script>

<template>
  <div class="section-page settings-page">
    <LazySettingsIntegrations />
  </div>
</template>
