<template>
  <header class="character-summary-card">
    <div class="character-summary-heading">
      <span class="character-summary-icon" aria-hidden="true">
        <slot name="icon" />
      </span>
      <div>
        <p class="eyebrow"><slot name="eyebrow" /></p>
        <h2>
          <slot name="value" />
          <span><slot name="label" /></span>
        </h2>
      </div>
    </div>
    <div class="character-summary-details">
      <slot />
    </div>
  </header>
</template>
