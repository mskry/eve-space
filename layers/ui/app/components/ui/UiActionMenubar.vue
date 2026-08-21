<script setup lang="ts">
import {
  MenubarContent,
  MenubarItem,
  MenubarLabel,
  MenubarMenu,
  MenubarPortal,
  MenubarRoot,
  MenubarSeparator,
  MenubarTrigger,
} from 'reka-ui'

interface ActionItem {
  label: string
  tone?: 'default' | 'danger'
  value: string
}

defineProps<{
  description?: string
  items: readonly ActionItem[]
  label: string
}>()

const emit = defineEmits<{
  select: [value: string]
}>()
</script>

<template>
  <MenubarRoot class="ui-action-menubar" loop>
    <MenubarMenu>
      <MenubarTrigger as-child>
        <slot name="trigger" />
      </MenubarTrigger>
      <MenubarPortal defer>
        <MenubarContent class="ui-action-menu" side="right" align="end" :side-offset="10">
          <MenubarLabel class="ui-action-menu-label">
            <strong>{{ label }}</strong>
            <span v-if="description">{{ description }}</span>
          </MenubarLabel>
          <MenubarSeparator class="ui-action-menu-separator" />
          <MenubarItem
            v-for="item in items"
            :key="item.value"
            :class="[
              'ui-action-menu-item',
              { 'ui-action-menu-item--danger': item.tone === 'danger' },
            ]"
            @select="emit('select', item.value)"
          >
            {{ item.label }}
          </MenubarItem>
        </MenubarContent>
      </MenubarPortal>
    </MenubarMenu>
  </MenubarRoot>
</template>
