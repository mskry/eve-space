<script setup lang="ts">
import { useQuery } from '@pinia/colada'
import { defineEsiQueryOptions, toApiQueryError } from '@eve-space/platform-module-nuxt/runtime'

interface PublicFixtureResponse {
  readonly marker: 'PUBLIC_ESI_FIXTURE'
  readonly text: string
}

const publicFixtureQuery = defineEsiQueryOptions((apiBase: string) => ({
  esiPersistence: { kind: 'public-esi' },
  key: ['public', 'e2e', 'query-persistence'] as const,
  query: async ({ signal }: { signal: AbortSignal }) => {
    const response = await fetch(new URL('/api/e2e/public-esi', apiBase), {
      credentials: 'include',
      signal,
    })
    if (response.status !== 200) {
      throw await toApiQueryError(response, 'Public ESI fixture is unavailable.')
    }
    return (await response.json()) as PublicFixtureResponse
  },
  ssrCatchError: true,
  staleTime: 60_000,
}))

definePageMeta({
  layout: false,
  platformAudience: 'public',
  title: 'Query Persistence Fixture',
})

const runtimeConfig = useRuntimeConfig()
const nuxtApp = useNuxtApp()
const route = useRoute()
const clientFetchMode = route.query.source === 'client'
const query = useQuery({
  ...publicFixtureQuery(runtimeConfig.public.apiBase),
  enabled: !clientFetchMode,
})
const publicData = query.data
const clientMounted = ref(false)
const displayedPublicData = computed(() =>
  clientFetchMode && !clientMounted.value ? undefined : publicData.value,
)

if (import.meta.client) {
  const browserState = globalThis as typeof globalThis & {
    e2ePublicHistory?: Array<{ hydrating: boolean; text: string }>
  }
  browserState.e2ePublicHistory = []
  watch(
    publicData,
    (value) => {
      if (!value) {
        return
      }
      browserState.e2ePublicHistory!.push({
        hydrating: nuxtApp.isHydrating === true,
        text: value.text,
      })
    },
    { flush: 'sync', immediate: true },
  )
}

if (clientFetchMode && import.meta.client) {
  await query.refetch()
}

onMounted(() => {
  clientMounted.value = true
})

useHead({ title: 'Query Persistence Fixture // EVE Space' })
</script>

<template>
  <main id="main-content" tabindex="-1">
    <h1>Query persistence fixture</h1>
    <p data-testid="public-marker">{{ displayedPublicData?.marker ?? 'NO_PUBLIC_MARKER' }}</p>
    <p data-testid="public-value">{{ displayedPublicData?.text ?? 'NO_PUBLIC_DATA' }}</p>
    <output data-testid="public-history" :data-client-mounted="clientMounted">
      Client readiness marker
    </output>
    <button type="button" @click="query.refetch()">Refresh public fixture</button>
  </main>
</template>
