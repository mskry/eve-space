<script setup lang="ts">
const MAIL_LABEL_COLORS = [
  '#0000fe',
  '#006634',
  '#0099ff',
  '#00ff33',
  '#01ffff',
  '#349800',
  '#660066',
  '#666666',
  '#999999',
  '#99ffff',
  '#9a0000',
  '#ccff9a',
  '#e6e6e6',
  '#fe0000',
  '#ff6600',
  '#ffff01',
  '#ffffcd',
  '#ffffff',
] as const

type MailLabelColor = (typeof MAIL_LABEL_COLORS)[number]
const color = defineModel<MailLabelColor | undefined>({ default: undefined })
const displayedColor = computed({
  get: () => color.value ?? '#ffffff',
  set: (value: string | undefined) => {
    color.value = value as MailLabelColor | undefined
  },
})
const options = MAIL_LABEL_COLORS.map((value) => ({ label: `Label color ${value}`, value }))
</script>

<template>
  <UiRadioGroup
    v-model="displayedColor"
    class="mail-label-swatch-grid"
    label="Label color"
    :options="options"
  >
    <template #option="{ option }">
      <span class="mail-label-swatch" :style="{ backgroundColor: option.value }" />
    </template>
  </UiRadioGroup>
</template>
