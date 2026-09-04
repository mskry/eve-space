<script setup lang="ts">
withDefaults(
  defineProps<{
    actionLabel?: string
    authorizeUrl?: string | null
    code?: string
    message?: string | null
    title: string
  }>(),
  {
    actionLabel: 'AUTHORIZE THIS CHARACTER',
    authorizeUrl: null,
    code: 'ESI 403 / SCOPE',
    message: null,
  },
)

defineSlots<{
  action(): unknown
}>()
</script>

<template>
  <div class="esi-authorization-required" role="alert">
    <div class="esi-authorization-required-copy">
      <span class="esi-authorization-required-code">{{ code }}</span>
      <h2>{{ title }}</h2>
      <p v-if="message">{{ message }}</p>
    </div>
    <a v-if="authorizeUrl" class="esi-authorization-required-action" :href="authorizeUrl">
      {{ actionLabel }}
    </a>
    <slot v-else name="action" />
  </div>
</template>

<style>
.esi-authorization-required {
  min-width: 0;
  padding: 0.625rem 0.75rem;
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 0.625rem 0.875rem;
  border: 0.0625rem solid color-mix(in srgb, var(--ui-warning) 45%, var(--ui-border));
  border-left-width: 0.1875rem;
  background: color-mix(in srgb, var(--ui-warning) 6%, var(--ui-surface));
}

.esi-authorization-required-copy {
  min-width: 10rem;
  flex: 1 1 14rem;
  display: grid;
  grid-template-columns: auto minmax(0, 1fr);
  align-items: baseline;
  gap: 0.25rem 0.625rem;
}

.esi-authorization-required-code {
  color: var(--ui-warning);
  font: 700 0.5rem/1.2 var(--ui-font-mono);
  letter-spacing: 0.1em;
  white-space: nowrap;
}

.esi-authorization-required h2 {
  margin: 0;
  color: var(--ui-text);
  font: 600 0.75rem/1.25 var(--ui-font-body);
}

.esi-authorization-required p {
  min-width: 0;
  margin: 0;
  grid-column: 1 / -1;
  color: var(--ui-text-muted);
  font: 0.625rem/1.4 var(--ui-font-body);
  overflow-wrap: anywhere;
}

.esi-authorization-required-action,
.esi-authorization-required button {
  min-height: 1.875rem;
  padding: 0.5rem 0.625rem;
  display: inline-flex;
  flex: 0 1 auto;
  align-items: center;
  justify-content: center;
  border: 0.0625rem solid var(--ui-warning);
  background: transparent;
  color: var(--ui-warning);
  font: 700 0.5rem/1.2 var(--ui-font-mono);
  letter-spacing: 0.08em;
  text-align: center;
  text-decoration: none;
  overflow-wrap: anywhere;
  cursor: pointer;
}

.esi-authorization-required-action:hover,
.esi-authorization-required-action:focus-visible,
.esi-authorization-required button:hover,
.esi-authorization-required button:focus-visible {
  outline: 0.125rem solid color-mix(in srgb, var(--ui-warning) 35%, transparent);
  outline-offset: 0.125rem;
  background: color-mix(in srgb, var(--ui-warning) 9%, transparent);
}
</style>
