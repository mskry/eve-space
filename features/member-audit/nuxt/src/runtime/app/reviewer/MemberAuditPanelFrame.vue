<script setup lang="ts">
import type { VNode } from 'vue'

defineProps<{
  classification: 'Sensitive organization data' | 'Organization access data'
  description: string
  permission: string
  target: string
  title: string
}>()

defineSlots<{ default(): VNode[] }>()
</script>

<template>
  <section class="member-audit-panel" :aria-labelledby="`member-audit-${permission}-title`">
    <header>
      <p class="member-audit-panel__classification">{{ classification }}</p>
      <h2 :id="`member-audit-${permission}-title`">{{ title }}</h2>
      <p>{{ description }}</p>
      <dl>
        <div>
          <dt>Target</dt>
          <dd>{{ target }}</dd>
        </div>
        <div>
          <dt>Required permission</dt>
          <dd>
            <code>{{ permission }}</code>
          </dd>
        </div>
      </dl>
    </header>
    <slot />
  </section>
</template>

<style scoped>
.member-audit-panel {
  display: grid;
  min-width: 0;
  gap: 1rem;
  color: var(--ui-text);
}

.member-audit-panel h2,
.member-audit-panel p {
  margin-block: 0 0.5rem;
}

.member-audit-panel__classification {
  color: var(--ui-text-muted);
  font: 700 0.75rem/1.2 var(--ui-font-mono);
  letter-spacing: 0.08em;
  text-transform: uppercase;
}

.member-audit-panel dl {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(min(100%, 14rem), 1fr));
  gap: 0.5rem 1rem;
  margin: 1rem 0 0;
}

.member-audit-panel dl div {
  min-width: 0;
}

.member-audit-panel dt {
  color: var(--ui-text-muted);
  font-size: 0.8rem;
}

.member-audit-panel dd {
  margin: 0.2rem 0 0;
  overflow-wrap: anywhere;
}
</style>
