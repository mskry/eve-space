<script setup lang="ts">
import type { EveFormattedText } from '../../../api/src/text/eve-formatted-text'

const props = defineProps<{
  bio?: EveFormattedText | null
}>()

const bioCard = ref<HTMLElement>()
const bioCopy = ref<HTMLElement>()
const bioExpandedHeight = ref(0)
const bioIsOverflowing = ref(false)

function measureBioExpansion() {
  const card = bioCard.value
  const copy = bioCopy.value
  bioExpandedHeight.value = card?.parentElement?.offsetHeight ?? card?.offsetHeight ?? 0
  bioIsOverflowing.value = (copy?.scrollHeight ?? 0) > (copy?.clientHeight ?? 0)
}

watch(
  () => props.bio,
  async () => {
    await nextTick()
    measureBioExpansion()
  },
)

onMounted(() => {
  window.addEventListener('resize', measureBioExpansion)
  measureBioExpansion()
})

onBeforeUnmount(() => window.removeEventListener('resize', measureBioExpansion))
</script>

<template>
  <div
    ref="bioCard"
    class="overview-bio-card"
    :class="{ 'overview-bio-card--expandable': bioIsOverflowing }"
    :style="{ '--bio-expanded-height': `${bioExpandedHeight}px` }"
  >
    <span class="card-index">01</span>
    <p>BIO</p>
    <div ref="bioCopy" class="overview-bio-copy">
      <EveFormattedText v-if="bio" :value="bio" />
      <template v-else>No biography recorded.</template>
    </div>
  </div>
</template>
