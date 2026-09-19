<script setup lang="ts">
import { formatSystemSecurityStatus, getSystemSecurityBand } from '../utils/system-security'

const props = defineProps<{
  value: number
}>()

const label = computed(() => formatSystemSecurityStatus(props.value))
const band = computed(() => getSystemSecurityBand(props.value))
</script>

<template>
  <span class="system-security-status" :class="`system-security-status--${band}`">
    <span class="sr-only">System security:</span>
    {{ label }}
  </span>
</template>

<style scoped>
.system-security-status {
  flex: 0 0 auto;
  color: var(--system-security-status-color);
  font-family: var(--ui-font-mono);
  font-weight: 500;
  line-height: 1;
  text-align: right;
}

.system-security-status--10 {
  --system-security-status-color: var(--ui-system-security-10);
}

.system-security-status--9 {
  --system-security-status-color: var(--ui-system-security-09);
}

.system-security-status--8 {
  --system-security-status-color: var(--ui-system-security-08);
}

.system-security-status--7 {
  --system-security-status-color: var(--ui-system-security-07);
}

.system-security-status--6 {
  --system-security-status-color: var(--ui-system-security-06);
}

.system-security-status--5 {
  --system-security-status-color: var(--ui-system-security-05);
}

.system-security-status--4 {
  --system-security-status-color: var(--ui-system-security-04);
}

.system-security-status--3 {
  --system-security-status-color: var(--ui-system-security-03);
}

.system-security-status--2 {
  --system-security-status-color: var(--ui-system-security-02);
}

.system-security-status--1 {
  --system-security-status-color: var(--ui-system-security-01);
}

.system-security-status--0 {
  --system-security-status-color: var(--ui-system-security-00);
}
</style>
