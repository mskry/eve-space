<script setup lang="ts">
import { useQuery } from '@pinia/colada'
import { publicTypeDetailQuery, type PublicTypeDetail } from '../queries/universe'
import { ApiQueryError } from '../utils/query-error'

const props = withDefaults(
  defineProps<{
    descriptionId: string
    detailsLabel?: string
    fallbackItem?: PublicTypeDetail
    imageKind?: 'type-bp' | 'type-bpc' | 'type-icon'
    imageSource?: string
    titleId: string
    typeId: number
  }>(),
  { imageKind: 'type-icon' },
)

defineSlots<{
  details(props: { item: PublicTypeDetail }): unknown
}>()

const runtimeConfig = useRuntimeConfig()
const apiClient = createApiClient(runtimeConfig.public.apiBase)
const itemQuery = useQuery(() => publicTypeDetailQuery({ apiClient, typeId: props.typeId }))
const item = computed(() => {
  if (itemQuery.data.value) {
    return itemQuery.data.value
  }
  const error = itemQuery.error.value
  return error instanceof ApiQueryError && error.code === 'TYPE_NOT_FOUND'
    ? props.fallbackItem
    : undefined
})
const contentStatus = computed<'loaded' | 'loading' | 'unavailable'>(() => {
  if (item.value) {
    return 'loaded'
  }
  if (itemQuery.status.value === 'error') {
    return 'unavailable'
  }
  return 'loading'
})
</script>

<template>
  <EveItemInformationContent
    :description-id="descriptionId"
    :details-label="detailsLabel"
    :image-kind="imageKind"
    :image-source="imageSource"
    :item="item"
    :status="contentStatus"
    :title-id="titleId"
    @retry="itemQuery.refetch()"
  >
    <template #details>
      <slot v-if="item" name="details" :item="item" />
    </template>
  </EveItemInformationContent>
</template>
