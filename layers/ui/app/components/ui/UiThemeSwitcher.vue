<script setup lang="ts">
import {
  DropdownMenuContent,
  DropdownMenuItemIndicator,
  DropdownMenuLabel,
  DropdownMenuPortal,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuRoot,
  DropdownMenuTrigger,
} from 'reka-ui'

const { setTheme, theme, themes } = useTheme()
const activeTheme = computed(
  () => themes.find((option) => option.value === theme.value) ?? themes[0],
)
</script>

<template>
  <DropdownMenuRoot>
    <DropdownMenuTrigger
      class="ui-theme-trigger"
      :aria-label="`Change theme. Current theme: ${activeTheme.label}`"
    >
      <span class="ui-theme-swatch" aria-hidden="true" />
      <span class="ui-theme-trigger-copy">THEME / {{ activeTheme.label }}</span>
    </DropdownMenuTrigger>

    <DropdownMenuPortal>
      <DropdownMenuContent class="ui-theme-menu" align="end" :side-offset="8">
        <DropdownMenuLabel class="ui-theme-menu-label"> INTERFACE THEME </DropdownMenuLabel>
        <DropdownMenuRadioGroup :model-value="theme" @update:model-value="setTheme">
          <DropdownMenuRadioItem
            v-for="option in themes"
            :key="option.value"
            class="ui-theme-option"
            :value="option.value"
          >
            <DropdownMenuItemIndicator class="ui-theme-option-indicator">
              ◆
            </DropdownMenuItemIndicator>
            <span>{{ option.label }}</span>
            <span class="ui-theme-option-code">{{ option.code }}</span>
          </DropdownMenuRadioItem>
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenuPortal>
  </DropdownMenuRoot>
</template>
