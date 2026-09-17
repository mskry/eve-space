<template>
  <section class="member-audit-module-unavailable" aria-labelledby="member-audit-unavailable-title">
    <h2 id="member-audit-unavailable-title">Member audit is not available</h2>
    <p>An administrator must enable the module and its evidence sections before use.</p>
  </section>
</template>

<style scoped>
.member-audit-module-unavailable {
  display: grid;
  gap: var(--ui-space-3);
}

.member-audit-module-unavailable h2,
.member-audit-module-unavailable p {
  margin: 0;
}
</style>
