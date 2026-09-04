<script setup lang="ts">
import { useQuery } from '@pinia/colada'
import { publicTypeDetailQuery, type PublicTypeDetail } from '../queries/universe'

const props = defineProps<{
  descriptionId: string
  detailsLabel?: string
  imageKind?: 'type-bp' | 'type-bpc' | 'type-icon'
  imageSource?: string
  titleId: string
  typeId: number
}>()

defineSlots<{
  details(props: { item: PublicTypeDetail }): unknown
}>()

const runtimeConfig = useRuntimeConfig()
const apiClient = createApiClient(runtimeConfig.public.apiBase)
const itemQuery = useQuery(() => publicTypeDetailQuery({ apiClient, typeId: props.typeId }))
const item = itemQuery.data
const contentStatus = computed<'loaded' | 'loading' | 'unavailable'>(() => {
  if (item.value) return 'loaded'
  if (itemQuery.status.value === 'error') return 'unavailable'
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
