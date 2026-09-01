<script setup lang="ts">
import { TabsContent, TabsList, TabsRoot, TabsTrigger } from 'reka-ui'

interface UiTab {
  label: string
  value: string
}

const props = withDefaults(
  defineProps<{
    ariaLabel?: string
    defaultValue?: string
    tabs: readonly UiTab[]
  }>(),
  {
    ariaLabel: 'Sections',
    defaultValue: undefined,
  },
)

defineSlots<Record<string, () => unknown>>()

const initialValue = computed(() => props.defaultValue ?? props.tabs[0]?.value)
</script>

<template>
  <TabsRoot class="ui-tabs" :default-value="initialValue" :unmount-on-hide="false">
    <TabsList class="ui-tabs-list" :aria-label="ariaLabel">
      <TabsTrigger v-for="tab in tabs" :key="tab.value" class="ui-tabs-trigger" :value="tab.value">
        {{ tab.label }}
      </TabsTrigger>
    </TabsList>

    <TabsContent v-for="tab in tabs" :key="tab.value" class="ui-tabs-content" :value="tab.value">
      <slot :name="tab.value" />
    </TabsContent>
  </TabsRoot>
</template>
