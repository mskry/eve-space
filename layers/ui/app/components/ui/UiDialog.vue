<script setup lang="ts">
import {
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogOverlay,
  DialogPortal,
  DialogRoot,
  DialogTitle,
  DialogTrigger,
} from 'reka-ui'

defineOptions({ inheritAttrs: false })

withDefaults(
  defineProps<{
    closeLabel?: string
    description: string
    title: string
  }>(),
  {
    closeLabel: 'Close dialog',
  },
)

const open = defineModel<boolean>('open', { default: false })
</script>

<template>
  <DialogRoot v-model:open="open">
    <DialogTrigger v-if="$slots.trigger" as-child>
      <slot name="trigger" />
    </DialogTrigger>

    <DialogPortal defer>
      <DialogOverlay class="ui-dialog-overlay" />
      <DialogContent class="ui-dialog-content" v-bind="$attrs">
        <header class="ui-dialog-header">
          <DialogTitle class="ui-dialog-title">{{ title }}</DialogTitle>
          <DialogDescription class="ui-dialog-description">
            {{ description }}
          </DialogDescription>
          <DialogClose class="ui-dialog-close" :aria-label="closeLabel">
            <span aria-hidden="true">X</span>
          </DialogClose>
        </header>

        <div class="ui-dialog-body">
          <slot />
        </div>

        <footer v-if="$slots.footer" class="ui-dialog-footer">
          <slot name="footer" />
        </footer>
      </DialogContent>
    </DialogPortal>
  </DialogRoot>
</template>
