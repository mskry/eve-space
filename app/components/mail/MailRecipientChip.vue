<script setup lang="ts">
import type { MailRecipient } from '../../queries/mail'
import { mailPartyName } from '../../utils/mail-view'

defineProps<{
  recipient: MailRecipient
}>()

defineEmits<{
  remove: []
}>()
</script>

<template>
  <span class="mail-recipient-chip">
    <span>
      <strong>{{ mailPartyName(recipient, 'recipient') }}</strong>
      <small>{{ recipient.type.replace('_', ' ') }}</small>
    </span>
    <button
      type="button"
      :aria-label="`Remove ${mailPartyName(recipient, 'recipient')}`"
      @click="$emit('remove')"
    >
      REMOVE
    </button>
  </span>
</template>
