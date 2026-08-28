<script setup lang="ts">
withDefaults(
  defineProps<{
    authorizeUrl?: string
    message: string
    title: string
  }>(),
  {
    authorizeUrl: '',
  },
)
</script>

<template>
  <div class="character-authorization-state" role="status">
    <span class="private-badge">SCOPE REQUIRED</span>
    <div>
      <h2>{{ title }}</h2>
      <p>{{ message }}</p>
    </div>
    <a v-if="authorizeUrl" class="ui-action-primary" :href="authorizeUrl">
      AUTHORIZE THIS CHARACTER
    </a>
  </div>
</template>

<style scoped>
.character-authorization-state {
  min-height: 15.625rem;
  padding: clamp(1.75rem, 5vw, 3.125rem);
  display: grid;
  grid-template-columns: auto minmax(0, 1fr) auto;
  align-items: center;
  gap: 1.5rem;
  border: 0.0625rem solid var(--ui-border);
  background: var(--ui-surface);
}

.character-authorization-state h2 {
  margin: 0;
  font-size: 1.75rem;
  font-weight: 400;
}

.character-authorization-state p {
  margin: 0.625rem 0 0;
  color: var(--ui-text-muted);
  font-size: 0.6875rem;
  line-height: 1.6;
}

@media (max-width: 47.5rem) {
  .character-authorization-state {
    grid-template-columns: 1fr;
  }

  .character-authorization-state .ui-action-primary {
    width: max-content;
  }
}
</style>
