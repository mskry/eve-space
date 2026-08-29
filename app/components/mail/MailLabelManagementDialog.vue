<script setup lang="ts">
import type { CreateMailLabelMutationParameters, MailLabel } from '../../queries/mail'

type MailLabelColor = NonNullable<CreateMailLabelMutationParameters['color']>

const props = defineProps<{
  createFeedback: string
  creating: boolean
  deletePendingIds: ReadonlySet<number>
  labels: readonly MailLabel[]
  undeletableLabelIds: ReadonlySet<number>
}>()

const emit = defineEmits<{
  create: []
  delete: [label: MailLabel]
}>()

const open = defineModel<boolean>('open', { default: false })
const name = defineModel<string>('name', { required: true })
const color = defineModel<MailLabelColor | undefined>('color', { default: undefined })
const trimmedName = computed(() => name.value.trim())
const nameError = computed(() => {
  if (trimmedName.value.length === 0) return 'Enter a label name between 1 and 40 characters.'
  if (trimmedName.value.length > 40) return 'Label names can contain at most 40 characters.'
  return ''
})

function labelName(label: MailLabel) {
  return (
    label.name?.trim() || (label.labelId === null ? 'Unnamed label' : `Label #${label.labelId}`)
  )
}
</script>

<template>
  <UiDialog
    v-model:open="open"
    class="mail-label-management-dialog"
    title="Manage mail labels"
    description="Create labels from EVE's fixed palette or remove labels from this character."
  >
    <form class="mail-label-create-form" @submit.prevent="!nameError && emit('create')">
      <label for="mail-label-name">LABEL NAME</label>
      <input
        id="mail-label-name"
        v-model="name"
        type="text"
        autocomplete="off"
        :aria-describedby="nameError ? 'mail-label-name-error' : 'mail-label-name-help'"
      />
      <p id="mail-label-name-help">1-40 characters after trimming.</p>
      <p v-if="nameError" id="mail-label-name-error" role="alert">{{ nameError }}</p>
      <fieldset>
        <legend>LABEL COLOR</legend>
        <MailLabelSwatchGrid v-model="color" />
        <p>White is EVE's default when no color has been explicitly chosen.</p>
      </fieldset>
      <p v-if="createFeedback" class="mail-label-action-feedback" role="alert">
        {{ createFeedback }}
      </p>
      <button class="ui-action-primary" type="submit" :disabled="creating || Boolean(nameError)">
        {{ creating ? 'CREATING...' : 'CREATE LABEL' }}
      </button>
    </form>

    <section class="mail-label-management-list" aria-labelledby="existing-mail-labels">
      <h3 id="existing-mail-labels">Existing labels</h3>
      <p v-if="labels.length === 0">No labels are available.</p>
      <div
        v-for="(label, index) in labels"
        :key="label.labelId ?? `unknown-${index}`"
        class="mail-label-management-row"
      >
        <span class="mail-label-name-with-swatch">
          <span
            v-if="label.color"
            class="mail-label-color"
            :style="{ backgroundColor: label.color }"
            aria-hidden="true"
          />
          <span>{{ labelName(label) }}</span>
        </span>
        <span v-if="label.labelId !== null && undeletableLabelIds.has(label.labelId)">
          EVE PROTECTED
        </span>
        <button
          v-else-if="label.labelId !== null"
          class="ui-action-secondary mail-label-delete-button"
          type="button"
          :disabled="deletePendingIds.has(label.labelId)"
          :aria-label="`Delete ${labelName(label)}`"
          @click="emit('delete', label)"
        >
          {{ deletePendingIds.has(label.labelId) ? 'DELETING...' : 'DELETE' }}
        </button>
      </div>
    </section>
  </UiDialog>
</template>
