<script setup lang="ts">
import type { PlatformCharacterProfileProps } from '@eve-space/platform-module-nuxt/runtime'

defineProps<PlatformCharacterProfileProps>()
</script>

<template>
  <section class="app-reviewer-character-profile" aria-label="Read-only character profile">
    <output v-if="state === 'loading'">Loading public character profile…</output>
    <output v-else-if="state === 'unavailable' || !profile">Public profile is unavailable.</output>
    <template v-else>
      <header class="app-reviewer-character-profile__header">
        <UiEveImage
          kind="character"
          :id="profile.id"
          :dimension="96"
          :width="96"
          :height="96"
          loading="lazy"
          decoding="async"
          :alt="`${profile.name} portrait`"
        />
        <div>
          <h2>{{ profile.name }}</h2>
          <p>Read-only character review</p>
          <p>{{ profile.corporation.name }} · {{ profile.corporation.ticker }}</p>
          <p v-if="profile.alliance">{{ profile.alliance.name }} · {{ profile.alliance.ticker }}</p>
        </div>
      </header>
      <div class="app-reviewer-character-profile__cards">
        <CharacterOverviewBioCard :bio="profile.bio" />
        <CharacterOverviewDetails :profile="profile" />
      </div>
    </template>
  </section>
</template>

<style scoped>
.app-reviewer-character-profile {
  display: grid;
  gap: 1rem;
  min-width: 0;
}

.app-reviewer-character-profile__header {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 1rem;
}

.app-reviewer-character-profile__header h2 {
  margin: 0;
}

.app-reviewer-character-profile__header p {
  margin: 0.25rem 0;
}

.app-reviewer-character-profile__cards {
  display: grid;
  gap: 1rem;
  grid-template-columns: repeat(auto-fit, minmax(min(100%, 18rem), 1fr));
}
</style>
