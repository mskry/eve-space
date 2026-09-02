<script setup lang="ts">
import { formatValidatedAt } from '../../../utils/format'
import { ApiQueryError } from '../../../utils/query-error'

const props = withDefaults(
  defineProps<{
    error?: Error | null
    hasData: boolean
    loading: boolean
    stale?: boolean
    title: string
    validatedAt?: string
  }>(),
  {
    error: null,
    stale: false,
    validatedAt: '',
  },
)

defineEmits<{
  retry: []
}>()

defineSlots<{
  default(): unknown
}>()

const apiError = computed(() => (props.error instanceof ApiQueryError ? props.error : undefined))
const scopeRequired = computed(
  () =>
    apiError.value?.code === 'EVE_SCOPE_REQUIRED' || apiError.value?.code === 'EVE_REAUTH_REQUIRED',
)
const errorCode = computed(() =>
  apiError.value?.status === 429 ? 'ESI / QUOTA' : `ESI ${apiError.value?.status ?? 502} / FINANCE`,
)
const errorMessage = computed(() => {
  const message = props.error?.message ?? 'This Finance resource is temporarily unavailable.'
  return apiError.value?.status === 429 && apiError.value.retryAfterSeconds !== undefined
    ? `${message} Retry after ${apiError.value.retryAfterSeconds} seconds.`
    : message
})
</script>

<template>
  <section class="finance-service" :aria-busy="loading" :aria-label="title">
    <CharacterAuthorizationRequired
      v-if="scopeRequired && !hasData"
      compact
      :title="`${title} not authorized`"
      :message="errorMessage"
      :authorize-url="apiError?.authorizeUrl"
    />

    <UiStatePanel v-else-if="loading && !hasData" compact role="status">
      <template #icon><div class="app-scanner" aria-hidden="true" /></template>
      <p>Loading {{ title.toLocaleLowerCase('en-US') }}...</p>
    </UiStatePanel>

    <UiStatePanel
      v-else-if="error && !hasData"
      :code="errorCode"
      :title="`${title} unavailable`"
      compact
      role="alert"
      tone="error"
    >
      <p>{{ errorMessage }}</p>
      <template #action>
        <button class="ui-action-secondary" type="button" @click="$emit('retry')">RETRY</button>
      </template>
    </UiStatePanel>

    <div v-else class="finance-service-content">
      <output v-if="stale" class="finance-stale-notice">
        Retained data is shown after an upstream refresh failure.
        <template v-if="validatedAt">Validated {{ formatValidatedAt(validatedAt) }} UTC.</template>
      </output>
      <p v-if="error" class="finance-inline-error" role="alert">{{ errorMessage }}</p>
      <slot />
    </div>
  </section>
</template>
