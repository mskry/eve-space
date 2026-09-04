<template>
  <svg
    class="app-information-icon"
    viewBox="0 0 24 24"
    width="16"
    height="16"
    fill="none"
    stroke="currentColor"
    stroke-width="1.5"
    aria-hidden="true"
    focusable="false"
  >
    <circle cx="12" cy="12" r="9" />
    <path d="M12 11.25v4.5" stroke-linecap="round" />
    <path d="M12 8.25h.01" stroke-linecap="round" />
  </svg>
</template>

<style scoped>
.app-information-icon {
  width: 1rem;
  height: 1rem;
  display: block;
  flex: 0 0 auto;
  color: var(--ui-text-faint);
}

:global(button:hover) .app-information-icon,
:global(button:focus-visible) .app-information-icon,
:global(button[data-state='open']) .app-information-icon {
  color: var(--ui-primary);
}
</style>
