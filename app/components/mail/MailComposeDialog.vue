<script setup lang="ts">
import type { MailRecipient } from '../../queries/mail'
import type { MailCompositionMode } from '../../composables/useMailComposition'
import { mailPartyName } from '../../utils/mail-view'

const props = defineProps<{
  bodyRemaining: number
  chargeRecoveryAvailable: boolean
  feedback: string
  mode: MailCompositionMode
  omitted: readonly string[]
  open: boolean
  recipients: readonly MailRecipient[]
  resolving: boolean
  searching: boolean
  searchAuthorizationMessage?: string
  searchAuthorizationUrl?: string
  sendAuthorizationMessage?: string
  sendAuthorizationUrl?: string
  sendDisabledReason: string
  sending: boolean
  subjectRemaining: number
  suggestions: readonly MailRecipient[]
}>()

const emit = defineEmits<{
  addRecipient: [recipient: MailRecipient]
  close: []
  recoverCharge: []
  removeRecipient: [recipient: MailRecipient]
  resolveRecipient: []
  send: []
}>()

const recipientInput = defineModel<string>('recipientInput', { required: true })
const subject = defineModel<string>('subject', { required: true })
const body = defineModel<string>('body', { required: true })
const guardedOpen = computed({
  get: () => props.open,
  set: (value: boolean) => {
    if (!value) emit('close')
  },
})

const title = computed(() => {
  if (props.mode === 'reply') return 'Reply to message'
  if (props.mode === 'reply-all') return 'Reply to all'
  if (props.mode === 'forward') return 'Forward message'
  return 'Compose new mail'
})
</script>

<template>
  <UiDialog
    v-model:open="guardedOpen"
    class="mail-compose-dialog"
    :title="title"
    description="Address and send plain-text EVE mail."
  >
    <div class="mail-compose">
      <div class="mail-compose-status-line">
        <span>{{ mode.replace('-', ' ').toUpperCase() }}</span>
        <span>{{ recipients.length }} / 50 RECIPIENTS</span>
      </div>

      <section class="mail-compose-recipients">
        <div class="mail-compose-field-heading">
          <label id="mail-compose-recipients-title" for="mail-recipient-input">Recipients</label>
          <span>{{ recipients.length }} / 50</span>
        </div>
        <div v-if="recipients.length > 0" class="mail-recipient-chips">
          <MailRecipientChip
            v-for="recipient in recipients"
            :key="`${recipient.type}:${recipient.id}`"
            :recipient="recipient"
            @remove="emit('removeRecipient', recipient)"
          />
        </div>
        <form class="mail-recipient-entry" @submit.prevent="emit('resolveRecipient')">
          <input
            id="mail-recipient-input"
            v-model="recipientInput"
            type="search"
            autocomplete="off"
            placeholder="Character, corporation, alliance, or mailing list"
          />
          <button type="submit" :disabled="resolving || recipientInput.trim().length < 1">
            {{ resolving ? 'RESOLVING...' : 'ADD EXACT NAME' }}
          </button>
        </form>
        <div v-if="suggestions.length > 0" class="mail-recipient-suggestions">
          <button
            v-for="recipient in suggestions"
            :key="`${recipient.type}:${recipient.id}`"
            type="button"
            @click="emit('addRecipient', recipient)"
          >
            <strong>{{ mailPartyName(recipient, 'recipient') }}</strong>
            <span>{{ recipient.type.replace('_', ' ') }}</span>
          </button>
        </div>
        <p v-else-if="searching" class="mail-compose-assist">Searching recipients...</p>
        <p v-if="searchAuthorizationMessage" class="mail-compose-assist">
          {{ searchAuthorizationMessage }}
          <a v-if="searchAuthorizationUrl" :href="searchAuthorizationUrl">Authorize search</a>
        </p>
      </section>

      <label class="mail-compose-field">
        <span class="mail-compose-field-heading">
          <span>Subject</span>
          <span :class="{ 'is-over-limit': subjectRemaining < 0 }">
            {{ subjectRemaining }} remaining
          </span>
        </span>
        <input v-model="subject" type="text" />
      </label>

      <label class="mail-compose-field mail-compose-body-field">
        <span class="mail-compose-field-heading">
          <span>Message</span>
          <span :class="{ 'is-over-limit': bodyRemaining < 0 }">
            {{ bodyRemaining }} remaining
          </span>
        </span>
        <textarea v-model="body" rows="12" />
      </label>

      <output v-if="omitted.length > 0" class="mail-compose-warning">
        Omitted because the recipient type could not be resolved: {{ omitted.join(', ') }}.
      </output>
      <p v-if="feedback" class="mail-compose-feedback" role="alert">{{ feedback }}</p>
      <p v-if="sendAuthorizationMessage" class="mail-compose-assist">
        {{ sendAuthorizationMessage }}
        <a v-if="sendAuthorizationUrl" :href="sendAuthorizationUrl">Authorize character</a>
      </p>
      <button
        v-if="chargeRecoveryAvailable"
        class="ui-action-secondary"
        type="button"
        @click="emit('recoverCharge')"
      >
        CHECK RECIPIENT CHARGE
      </button>

      <footer class="mail-compose-actions">
        <button
          type="button"
          class="ui-action-secondary"
          :disabled="sending"
          @click="emit('close')"
        >
          CANCEL
        </button>
        <div>
          <span v-if="sendDisabledReason">{{ sendDisabledReason }}</span>
          <button
            type="button"
            class="ui-action-primary"
            :disabled="Boolean(sendDisabledReason)"
            @click="emit('send')"
          >
            {{ sending ? 'SENDING...' : 'SEND MAIL' }}
          </button>
        </div>
      </footer>
    </div>
  </UiDialog>
</template>
