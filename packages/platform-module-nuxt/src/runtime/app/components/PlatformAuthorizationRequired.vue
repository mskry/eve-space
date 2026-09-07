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
    actionLabel: 'AUTHORIZE',
    authorizeUrl: null,
    code: 'AUTHORIZATION REQUIRED',
    message: null,
  },
)

defineSlots<{
  action(): unknown
}>()
</script>

<template>
  <div class="platform-authorization-required" role="alert">
    <div>
      <span>{{ code }}</span>
      <h2>{{ title }}</h2>
      <p v-if="message">{{ message }}</p>
    </div>
    <a v-if="authorizeUrl" :href="authorizeUrl">{{ actionLabel }}</a>
    <slot v-else name="action" />
  </div>
</template>

<style scoped>
.platform-authorization-required {
  min-width: 0;
  padding: 0.625rem 0.75rem;
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 0.625rem 0.875rem;
  border: 0.0625rem solid color-mix(in srgb, var(--ui-warning) 45%, var(--ui-border));
  border-left-width: 0.1875rem;
  background: color-mix(in srgb, var(--ui-warning) 6%, var(--ui-surface));
  color: var(--ui-text);
}

.platform-authorization-required > div {
  min-width: 10rem;
  flex: 1 1 14rem;
}

.platform-authorization-required span {
  color: var(--ui-warning);
  font: 700 0.5rem/1.2 var(--ui-font-mono);
  letter-spacing: 0.1em;
}

.platform-authorization-required h2,
.platform-authorization-required p {
  margin: 0.25rem 0 0;
}

.platform-authorization-required p {
  color: var(--ui-text-muted);
}

.platform-authorization-required a,
.platform-authorization-required :deep(button) {
  min-height: 1.875rem;
  padding: 0.5rem 0.625rem;
  border: 0.0625rem solid var(--ui-warning);
  background: transparent;
  color: var(--ui-warning);
  font: 700 0.5rem/1.2 var(--ui-font-mono);
  letter-spacing: 0.08em;
  text-decoration: none;
  cursor: pointer;
}
</style>
