<script setup lang="ts">
import { ref } from 'vue'
const state = ref('ready')
</script>
<template>
  <p>{{ state }}</p>
</template>
