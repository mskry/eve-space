<script setup lang="ts">
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
    name: 'Character Finance',
    detail: 'Scoped wallet, personal market-order and contract access with quota protection.',
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
  <section class="settings-subsection" aria-labelledby="settings-integrations-heading">
    <header class="settings-subsection-heading">
      <div>
        <p class="ui-eyebrow">01 / SETTINGS</p>
        <h2 id="settings-integrations-heading">Integrations</h2>
      </div>
      <p>Connected services and their authorization boundaries.</p>
    </header>
    <div class="integration-list">
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
    </div>
  </section>
</template>

<style>
@import url('~/assets/css/pages/settings.css');
@import url('~/assets/css/responsive/settings.css');
</style>
