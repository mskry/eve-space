<script setup lang="ts">
definePageMeta({ platformAudience: 'public' })
useHead({ title: 'API Explorer // EVE Space' })

const endpoint = `${useRuntimeConfig().public.apiBase.replace(/\/$/, '')}/api/graphql`
</script>

<template>
  <section class="api-explorer">
    <h1>API Explorer</h1>
    <p>
      Explore the API with GraphiQL. Its schema browser shows the fields exposed by this deployment.
      The API checks your session and permissions for every read.
    </p>
    <NuxtLink :to="endpoint" external>Open GraphiQL</NuxtLink>
  </section>
</template>

<style scoped>
.api-explorer {
  display: grid;
  gap: 1rem;
}

.api-explorer a {
  color: var(--ui-primary);
}
</style>
