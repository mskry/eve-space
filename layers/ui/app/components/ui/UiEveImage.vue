<script setup lang="ts">
import { useEveImages, type EveImageSize } from '../../composables/useEveImages'

type EveImageDimension = 32 | 34 | 36 | 40 | 42 | 44 | 48 | 64 | 72 | 84
type EveImageKind =
  | 'alliance'
  | 'character'
  | 'corporation'
  | 'faction'
  | 'type-bp'
  | 'type-bpc'
  | 'type-icon'
  | 'type-relic'
  | 'type-render'

const typeVariations = {
  'type-bp': 'bp',
  'type-bpc': 'bpc',
  'type-icon': 'icon',
  'type-relic': 'relic',
  'type-render': 'render',
} as const

const props = defineProps<{
  alt: string
  dimension: EveImageDimension
  id: number | string
  kind: EveImageKind
}>()

const { allianceLogo, characterPortrait, corporationLogo, factionLogo, typeImage } = useEveImages()
const source = computed(() => imageUrl(sourceSize(props.dimension)))
const sourceSet = computed(() => {
  const standard = sourceSize(props.dimension)
  const highDensity = sourceSize(props.dimension * 2)
  return `${imageUrl(standard)} 1x, ${imageUrl(highDensity)} 2x`
})
const isLogo = computed(() => props.kind === 'alliance' || props.kind === 'corporation')

function imageUrl(size: EveImageSize) {
  const kind = props.kind
  if (kind === 'alliance') return allianceLogo(props.id, size)
  if (kind === 'character') return characterPortrait(props.id, size)
  if (kind === 'corporation') return corporationLogo(props.id, size)
  if (kind === 'faction') return factionLogo(props.id, size)
  return typeImage(props.id, typeVariations[kind], size)
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
    class="ui-eve-image"
    :class="{
      'ui-eve-image--logo': isLogo,
      'ui-eve-image--portrait': kind === 'character',
    }"
    :src="source"
    :srcset="sourceSet"
    :alt="alt"
    :width="dimension"
    :height="dimension"
  />
</template>

<style scoped>
.ui-eve-image {
  box-sizing: border-box;
  display: block;
  flex: 0 0 auto;
  object-fit: contain;
}

.ui-eve-image--portrait {
  object-fit: cover;
}

.ui-eve-image--logo {
  padding: 4px;
  background: var(--ui-logo-background);
}
</style>
