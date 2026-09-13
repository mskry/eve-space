<script setup lang="ts">
import { createKeyedMailParagraphs } from '../../utils/mail-view'

const props = defineProps<{ body: string | null }>()
const keyedMailParagraphs = createKeyedMailParagraphs()
const paragraphs = computed(() => keyedMailParagraphs(props.body))
</script>

<template>
  <div class="mail-body-text">
    <p v-for="paragraph in paragraphs" :key="paragraph.key">{{ paragraph.item }}</p>
    <p v-if="paragraphs.length === 0" class="mail-body-empty">No message body was returned.</p>
  </div>
</template>
