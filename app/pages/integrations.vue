<script setup lang="ts">
definePageMeta({ title: 'Integrations' })
useHead({ title: 'Integrations // EVE Space' })

const integrations = [
  {
    name: 'EVE Public ESI',
    detail: 'Character, corporation, alliance, race and bloodline records.',
    state: 'ACTIVE',
    tone: 'active',
  },
  {
    name: 'EVE SSO',
    detail: 'Authorization Code flow, encrypted tokens and local sessions.',
    state: 'CONFIGURED',
    tone: 'active',
  },
  {
    name: 'Character Wallet',
    detail: 'Protected balance with ETag revalidation and quota protection.',
    state: 'SCOPE BASED',
    tone: 'warning',
  },
  {
    name: 'Alliance Services',
    detail: 'Reserved extension point for future organization plugins.',
    state: 'PLANNED',
    tone: 'muted',
  },
]
</script>

<template>
  <div class="section-page integrations-page">
    <header class="page-heading">
      <div>
        <p class="eyebrow">INTEGRATIONS</p>
        <h1>Integrations</h1>
      </div>
      <p>Each service owns an explicit route and authorization boundary within the dashboard.</p>
    </header>
    <section class="integration-list">
      <article
        v-for="(integration, index) in integrations"
        :key="integration.name"
        class="integration-row"
      >
        <span class="integration-index">0{{ index + 1 }}</span>
        <div>
          <strong>{{ integration.name }}</strong>
          <p>{{ integration.detail }}</p>
        </div>
        <span class="integration-state" :class="integration.tone">{{ integration.state }}</span>
      </article>
    </section>
  </div>
</template>
