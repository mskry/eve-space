<script setup lang="ts">
import { splitMailBodyParagraphs } from '../../utils/mail-view'

const props = defineProps<{ body: string | null }>()
const paragraphs = computed(() => splitMailBodyParagraphs(props.body))
</script>

<template>
  <div class="mail-body-text">
    <p v-for="(paragraph, index) in paragraphs" :key="index">{{ paragraph }}</p>
    <p v-if="paragraphs.length === 0" class="mail-body-empty">No message body was returned.</p>
  </div>
</template>
