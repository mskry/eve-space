<script setup lang="ts">
import {
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogOverlay,
  AlertDialogPortal,
  AlertDialogRoot,
  AlertDialogTitle,
} from 'reka-ui'

const props = withDefaults(
  defineProps<{
    cancelLabel?: string
    confirmLabel?: string
    description: string
    error?: string
    pending?: boolean
    pendingLabel?: string
    title: string
    tone?: 'default' | 'danger'
  }>(),
  {
    cancelLabel: 'Cancel',
    confirmLabel: 'Confirm',
    error: '',
    pending: false,
    pendingLabel: 'Confirming...',
    tone: 'default',
  },
)

const emit = defineEmits<{
  confirm: []
}>()
const open = defineModel<boolean>('open', { default: false })
const guardedOpen = computed({
  get: () => open.value,
  set: (value) => {
    if (value || !props.pending) open.value = value
  },
})
</script>

<template>
  <AlertDialogRoot v-model:open="guardedOpen">
    <AlertDialogPortal defer>
      <AlertDialogOverlay class="ui-confirm-dialog-overlay" />
      <AlertDialogContent class="ui-confirm-dialog-content">
        <span class="ui-confirm-dialog-eyebrow">CONFIRM ACTION</span>
        <AlertDialogTitle class="ui-confirm-dialog-title">{{ title }}</AlertDialogTitle>
        <AlertDialogDescription class="ui-confirm-dialog-description">
          {{ description }}
        </AlertDialogDescription>
        <p v-if="error" class="ui-confirm-dialog-error" role="alert">{{ error }}</p>
        <div class="ui-confirm-dialog-actions">
          <AlertDialogCancel class="ui-confirm-dialog-cancel" :disabled="pending">
            {{ cancelLabel }}
          </AlertDialogCancel>
          <button
            class="ui-confirm-dialog-action"
            :class="{ 'ui-confirm-dialog-action--danger': tone === 'danger' }"
            type="button"
            :disabled="pending"
            @click="emit('confirm')"
          >
            {{ pending ? pendingLabel : confirmLabel }}
          </button>
        </div>
      </AlertDialogContent>
    </AlertDialogPortal>
  </AlertDialogRoot>
</template>
