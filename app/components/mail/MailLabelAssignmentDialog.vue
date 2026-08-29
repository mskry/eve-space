<script setup lang="ts">
import type { MailLabel } from '../../queries/mail'

defineProps<{
  assignedLabelIds: ReadonlySet<number>
  feedback: string
  labels: readonly MailLabel[]
  pending: boolean
}>()

const emit = defineEmits<{
  change: [labelId: number, assigned: boolean]
}>()

const open = defineModel<boolean>('open', { default: false })

function labelName(label: MailLabel) {
  return (
    label.name?.trim() || (label.labelId === null ? 'Unnamed label' : `Label #${label.labelId}`)
  )
}
</script>

<template>
  <UiDialog
    v-model:open="open"
    class="mail-label-assignment-dialog"
    title="Assign mail labels"
    description="Choose the complete label set for this message. Existing labels stay assigned unless removed here."
  >
    <p v-if="feedback" class="mail-label-action-feedback" role="alert">{{ feedback }}</p>
    <div class="mail-label-assignment-list" aria-label="Available mail labels">
      <p v-if="labels.length === 0">No labels are available. Create one from Manage labels.</p>
      <label
        v-for="(label, index) in labels"
        :key="label.labelId ?? `unknown-${index}`"
        class="mail-label-assignment-row"
      >
        <input
          type="checkbox"
          :checked="label.labelId !== null && assignedLabelIds.has(label.labelId)"
          :disabled="pending || label.labelId === null"
          @change="
            label.labelId !== null &&
            emit('change', label.labelId, ($event.target as HTMLInputElement).checked)
          "
        />
        <span class="mail-label-assignment-check" aria-hidden="true" />
        <span
          v-if="label.color"
          class="mail-label-color"
          :style="{ backgroundColor: label.color }"
          aria-hidden="true"
        />
        <span>{{ labelName(label) }}</span>
      </label>
    </div>
  </UiDialog>
</template>
