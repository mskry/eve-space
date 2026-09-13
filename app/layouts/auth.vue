<template>
  <div class="auth-shell">
    <header class="auth-header">
      <NuxtLink class="sidebar-brand" to="/">
        <span class="brand-mark" aria-hidden="true">E</span>
        <span class="sidebar-brand-copy">
          <strong>NEOCOM</strong>
          <small>IDENTITY GATEWAY</small>
        </span>
      </NuxtLink>
      <div class="auth-header-actions">
        <UiThemeSwitcher />
        <NuxtLink to="/">RETURN TO DASHBOARD</NuxtLink>
      </div>
    </header>

    <main id="main-content" class="auth-stage" tabindex="-1">
      <slot />
    </main>

    <footer class="auth-footer">
      <span>SECURE EVE SSO / AUTHORIZATION CODE FLOW</span>
      <span>NO EVE CREDENTIALS ENTER THIS APPLICATION</span>
    </footer>
  </div>
</template>

<style>
@import url('~/assets/css/layouts/auth.css');
@import url('~/assets/css/responsive/auth.css');
</style>
