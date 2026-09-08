<script setup lang="ts">
const props = defineProps<{
  value: number
}>()

const displayedValue = computed(() => Number(Math.min(1, Math.max(-1, props.value)).toFixed(1)))
const label = computed(() => displayedValue.value.toFixed(1))
const band = computed(() => Math.min(10, Math.max(0, Math.round(displayedValue.value * 10))))
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
