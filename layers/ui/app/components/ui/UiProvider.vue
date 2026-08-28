<script setup lang="ts">
import { ConfigProvider, ToastProvider, ToastViewport, TooltipProvider } from 'reka-ui'

const { toast, toastOpen } = useToast()
const confirmDialog = provideConfirmDialog()
const confirmDialogOpen = computed({
  get: () => confirmDialog.dialogOpen.value,
  set: (open: boolean) => {
    if (open) confirmDialog.dialogOpen.value = true
    else confirmDialog.controller.closeConfirmDialog()
  },
})
</script>

<template>
  <ConfigProvider>
    <TooltipProvider :delay-duration="350" :skip-delay-duration="150">
      <ToastProvider>
        <slot />
        <UiToast
          :key="toast.key"
          v-model:open="toastOpen"
          :title="toast.title"
          :description="toast.description"
          :duration="toast.duration"
          :action-href="toast.actionHref || undefined"
          :action-label="toast.actionLabel"
        />
        <UiConfirmDialog
          v-model:open="confirmDialogOpen"
          :title="confirmDialog.title.value"
          :description="confirmDialog.description.value"
          :cancel-label="confirmDialog.cancelLabel.value"
          :confirm-label="confirmDialog.confirmLabel.value"
          :pending="confirmDialog.pending.value"
          :pending-label="confirmDialog.pendingLabel.value"
          :error="confirmDialog.actionError.value"
          :tone="confirmDialog.tone.value"
          @confirm="confirmDialog.confirmDialog"
        />
        <ToastViewport class="ui-toast-viewport" />
      </ToastProvider>
    </TooltipProvider>
  </ConfigProvider>
</template>
