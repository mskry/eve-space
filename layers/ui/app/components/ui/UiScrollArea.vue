<script setup lang="ts">
import type { ScrollAreaRootProps } from 'reka-ui'
import {
  ScrollAreaCorner,
  ScrollAreaRoot,
  ScrollAreaScrollbar,
  ScrollAreaThumb,
  ScrollAreaViewport,
} from 'reka-ui'

withDefaults(
  defineProps<{
    type?: ScrollAreaRootProps['type']
    scrollHideDelay?: number
    horizontal?: boolean
  }>(),
  {
    type: 'auto',
    scrollHideDelay: 600,
    horizontal: false,
  },
)

const scrollArea = useTemplateRef('scrollArea')
const viewport = computed(() => scrollArea.value?.viewport)

function scrollToElement(target: HTMLElement, offset = 0) {
  const element = viewport.value
  if (!element) return
  const top =
    target.getBoundingClientRect().top -
    element.getBoundingClientRect().top +
    element.scrollTop -
    offset
  element.scrollTo({
    top: Math.max(top, 0),
    behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth',
  })
}

defineExpose({ viewport, scrollToElement })
</script>

<template>
  <ScrollAreaRoot
    ref="scrollArea"
    class="ui-scroll-area"
    :type="type"
    :scroll-hide-delay="scrollHideDelay"
  >
    <ScrollAreaViewport class="ui-scroll-area-viewport">
      <slot />
    </ScrollAreaViewport>
    <ScrollAreaScrollbar class="ui-scroll-area-scrollbar" orientation="vertical">
      <ScrollAreaThumb class="ui-scroll-area-thumb" />
    </ScrollAreaScrollbar>
    <template v-if="horizontal">
      <ScrollAreaScrollbar class="ui-scroll-area-scrollbar" orientation="horizontal">
        <ScrollAreaThumb class="ui-scroll-area-thumb" />
      </ScrollAreaScrollbar>
      <ScrollAreaCorner class="ui-scroll-area-corner" />
    </template>
  </ScrollAreaRoot>
</template>
