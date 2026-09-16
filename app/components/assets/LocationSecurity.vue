<script setup lang="ts">
import { formatSystemSecurityStatus, getSystemSecurityBand } from '../../utils/system-security'

const props = defineProps<{
  value: number
}>()

const label = computed(() => formatSystemSecurityStatus(props.value))
const band = computed(() => getSystemSecurityBand(props.value))
</script>

<template>
  <span class="assets-location-security" :class="`assets-location-security--${band}`">
    <span class="sr-only">System security:</span>
    {{ label }}
  </span>
</template>

<style scoped>
.assets-location-security {
  min-width: 1.6rem;
  flex: 0 0 auto;
  color: var(--assets-location-security-color);
  font: 500 0.75rem/1 var(--ui-font-mono);
  text-align: right;
}

.assets-location-security--10 {
  --assets-location-security-color: var(--ui-system-security-10);
}

.assets-location-security--9 {
  --assets-location-security-color: var(--ui-system-security-09);
}

.assets-location-security--8 {
  --assets-location-security-color: var(--ui-system-security-08);
}

.assets-location-security--7 {
  --assets-location-security-color: var(--ui-system-security-07);
}

.assets-location-security--6 {
  --assets-location-security-color: var(--ui-system-security-06);
}

.assets-location-security--5 {
  --assets-location-security-color: var(--ui-system-security-05);
}

.assets-location-security--4 {
  --assets-location-security-color: var(--ui-system-security-04);
}

.assets-location-security--3 {
  --assets-location-security-color: var(--ui-system-security-03);
}

.assets-location-security--2 {
  --assets-location-security-color: var(--ui-system-security-02);
}

.assets-location-security--1 {
  --assets-location-security-color: var(--ui-system-security-01);
}

.assets-location-security--0 {
  --assets-location-security-color: var(--ui-system-security-00);
}
</style>
