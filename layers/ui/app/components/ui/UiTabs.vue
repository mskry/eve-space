<script setup lang="ts">
import { TabsContent, TabsIndicator, TabsList, TabsRoot, TabsTrigger } from 'reka-ui'

interface UiTab {
  label: string
  value: string
}

const props = withDefaults(
  defineProps<{
    ariaLabel?: string
    contentClass?: string
    defaultValue?: string
    listClass?: string
    tabs: readonly UiTab[]
    unmountOnHide?: boolean
  }>(),
  {
    ariaLabel: 'Sections',
    contentClass: undefined,
    defaultValue: undefined,
    listClass: undefined,
    unmountOnHide: false,
  },
)

defineSlots<Record<string, (props?: { tab: UiTab }) => unknown>>()

const modelValue = defineModel<string>()
const initialValue = computed(() => props.defaultValue ?? props.tabs[0]?.value)

watchEffect(() => {
  if (modelValue.value === undefined && initialValue.value !== undefined)
    modelValue.value = initialValue.value
})
</script>

<template>
  <TabsRoot
    v-model="modelValue"
    class="ui-tabs"
    :default-value="initialValue"
    :unmount-on-hide="unmountOnHide"
  >
    <TabsList :class="['ui-tabs-list', listClass]" :aria-label="ariaLabel">
      <TabsIndicator class="ui-tabs-indicator" />
      <TabsTrigger v-for="tab in tabs" :key="tab.value" class="ui-tabs-trigger" :value="tab.value">
        <slot name="trigger" :tab="tab">{{ tab.label }}</slot>
      </TabsTrigger>
    </TabsList>

    <TabsContent
      v-for="tab in tabs"
      :key="tab.value"
      :class="['ui-tabs-content', contentClass]"
      :value="tab.value"
    >
      <slot :name="tab.value" />
    </TabsContent>
  </TabsRoot>
</template>
