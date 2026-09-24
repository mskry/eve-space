<script setup lang="ts">
import { useCharacterAssets } from '../../../composables/useCharacterAssets'
import { PRIVATE_QUERY_KEYS } from '../../../queries/query-keys'
import type { AssetResourceAction } from '../../../types/assets'
import { parseRouteId } from '../../../utils/route-id'

definePageMeta({ layout: 'headerless', title: 'Character Assets' })

const route = useRoute()
const runtimeConfig = useRuntimeConfig()
const apiClient = createApiClient(runtimeConfig.public.apiBase)
const { authLoading, authSession } = useAuthSession(apiClient)
const { characters } = useCharacterRoster(apiClient)
const characterId = computed(() => parseRouteId(route.params.characterId))
const authenticated = computed(() => authSession.value.authenticated)
const authenticationReady = computed(() => !authLoading.value)
const assetsService = useCharacterAssets({
  apiClient,
  authenticated,
  authenticationReady,
  characterId,
  characters,
})
const assetsPersistencePresentation = useQueryPersistencePresentation(() =>
  PRIVATE_QUERY_KEYS.characterAssets(characterId.value ?? 0),
)

function authorizeAssets(action: AssetResourceAction) {
  void navigateTo(action.href, { external: true })
}
</script>

<template>
  <section class="character-assets-route" aria-label="Character assets">
    <AssetsInventory
      :collection="assetsService.assets.value"
      :hierarchy="assetsService.hierarchy.value"
      :presentation="assetsPersistencePresentation"
      :route-jumps-by-system-id="assetsService.routeJumpsBySystemId.value"
      :route-rank-by-system-id="assetsService.routeRankBySystemId.value"
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
