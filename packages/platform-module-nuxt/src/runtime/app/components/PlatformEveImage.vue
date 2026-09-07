<script setup lang="ts">
import { computed } from 'vue'
import type { EveImageKind, EveImageSize } from '../../eve-images.js'
import { usePlatformEveImages } from '../composables/usePlatformEveImages.js'

const typeVariations = {
  'type-bp': 'bp',
  'type-bpc': 'bpc',
  'type-icon': 'icon',
  'type-relic': 'relic',
  'type-render': 'render',
} as const

const props = defineProps<{
  alt: string
  dimension: number
  id: number | string
  kind: EveImageKind
}>()

const images = usePlatformEveImages()
const source = computed(() => imageUrl(sourceSize(props.dimension)))
const sourceSet = computed(() => {
  const standard = sourceSize(props.dimension)
  const highDensity = sourceSize(props.dimension * 2)
  return `${imageUrl(standard)} 1x, ${imageUrl(highDensity)} 2x`
})

function imageUrl(size: EveImageSize) {
  if (props.kind === 'alliance') return images.allianceLogo(props.id, size)
  if (props.kind === 'character') return images.characterPortrait(props.id, size)
  if (props.kind === 'corporation') return images.corporationLogo(props.id, size)
  if (props.kind === 'faction') return images.factionLogo(props.id, size)
  return images.typeImage(props.id, typeVariations[props.kind], size)
}

function sourceSize(minimum: number): EveImageSize {
  if (minimum <= 32) return 32
  if (minimum <= 64) return 64
  if (minimum <= 128) return 128
  if (minimum <= 256) return 256
  if (minimum <= 512) return 512
  return 1024
}
</script>

<template>
  <img
    class="platform-eve-image"
    :src="source"
    :srcset="sourceSet"
    :alt="alt"
    :width="dimension"
    :height="dimension"
  />
</template>

<style scoped>
.platform-eve-image {
  box-sizing: border-box;
  display: block;
  flex: 0 0 auto;
  object-fit: contain;
}
</style>
