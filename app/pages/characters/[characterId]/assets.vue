<script setup lang="ts">
import { useCharacterAssets } from '../../../composables/useCharacterAssets'
import type { AssetResourceAction } from '../../../types/assets'
import { parseRouteId } from '../../../utils/route-id'

definePageMeta({ title: 'Character Assets', layout: 'headerless' })

const route = useRoute()
const runtimeConfig = useRuntimeConfig()
const apiClient = createApiClient(runtimeConfig.public.apiBase)
const { authSession } = useAuthSession(apiClient)
const { characters } = useCharacterRoster(apiClient)
const characterId = computed(() => parseRouteId(route.params.characterId))
const authenticated = computed(() => authSession.value.authenticated)
const selectedCharacter = computed(() =>
  characters.value.find((character) => character.characterId === characterId.value),
)
useHead({
  title: computed(() =>
    selectedCharacter.value
      ? `${selectedCharacter.value.name} Assets // EVE Space`
      : 'Character Assets // EVE Space',
  ),
})
const assetsService = useCharacterAssets({
  apiClient,
  authenticated,
  characterId,
  characters,
})

function authorizeAssets(action: AssetResourceAction) {
  void navigateTo(action.href, { external: true })
}
</script>

<template>
  <section class="character-assets-route" aria-label="Character assets">
    <AssetsWorkspace
      :collection="assetsService.assets.value"
      :state="assetsService.state.value"
      @authorize="authorizeAssets"
      @retry="assetsService.refreshAssets"
    />
  </section>
</template>

<style scoped>
.character-assets-route {
  width: 100%;
  min-width: 0;
  max-width: 100%;
}
</style>
