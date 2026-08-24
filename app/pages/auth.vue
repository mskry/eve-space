<script setup lang="ts">
definePageMeta({
  layout: 'auth',
  title: 'Authorization',
})

const runtimeConfig = useRuntimeConfig()
const apiClient = createApiClient(runtimeConfig.public.apiBase)
const { characterPortrait } = useEveImages()
const { authConfig, authFeedback, authFeedbackIsError, authLoading, authSession, logout } =
  useAuthSession(apiClient)

async function handleLogout() {
  await logout()
}

useHead({ title: 'Authorize Character // EVE Space' })
</script>

<template>
  <section class="auth-card">
    <div class="auth-card-mark" aria-hidden="true">
      <AppIcon name="auth" />
    </div>
    <p class="ui-eyebrow">SIGN IN</p>
    <h1>Authorize your capsuleer</h1>
    <p class="auth-intro">
      Continue to EVE Online to approve identity and wallet access. Your account credentials are
      handled only by EVE.
    </p>

    <p v-if="authFeedback" class="auth-feedback" :class="{ 'auth-error': authFeedbackIsError }">
      {{ authFeedback }}
    </p>

    <div v-if="authLoading" class="auth-progress">
      <span class="app-scanner" aria-hidden="true" />
      <strong>Checking authorization state</strong>
    </div>

    <div v-else-if="authSession.authenticated" class="authorized-identity">
      <img
        :src="characterPortrait(authSession.account.mainCharacter.characterId, 128)"
        :srcset="`${characterPortrait(authSession.account.mainCharacter.characterId, 128)} 1x, ${characterPortrait(authSession.account.mainCharacter.characterId, 256)} 2x`"
        alt=""
        width="72"
        height="72"
      />
      <div>
        <small>AUTHORIZED PILOT</small>
        <strong>{{ authSession.account.mainCharacter.name }}</strong>
        <span>MAIN CHARACTER {{ authSession.account.mainCharacter.characterId }}</span>
      </div>
      <div class="auth-actions">
        <NuxtLink class="ui-action-primary" to="/">ENTER DASHBOARD</NuxtLink>
        <button type="button" class="ui-action-secondary" @click="handleLogout">LOG OUT</button>
      </div>
    </div>

    <div v-else-if="authConfig?.configured" class="auth-connect">
      <a class="eve-login" :href="authConfig.loginUrl">
        <img
          src="https://web.ccpgamescdn.com/eveonlineassets/developers/eve-sso-login-white-large.png"
          alt="Log in with EVE Online"
        />
      </a>
      <div class="scope-list">
        <span><i /> Public character identity</span>
        <span><i /> Character wallet balance</span>
        <span><i /> Local encrypted token storage</span>
      </div>
    </div>

    <p v-else class="auth-unavailable">EVE SSO credentials have not been configured.</p>
  </section>
</template>
