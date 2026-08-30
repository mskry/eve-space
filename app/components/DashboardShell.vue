<script setup lang="ts">
import { useQuery, useQueryCache } from '@pinia/colada'
import { adminSessionQuery } from '../queries/admin'
import { mailLabelsQuery } from '../queries/mail'
import { canRunProtectedQuery, prefetchQuery } from '../queries/query-cache'
import { resolveMailUnreadCount } from '../utils/mail-unread-badge'
import { systemStatusQuery } from '../queries/system-status'

const props = withDefaults(
  defineProps<{
    hideTopbar?: boolean
  }>(),
  { hideTopbar: false },
)

const route = useRoute()
const runtimeConfig = useRuntimeConfig()
const apiClient = createApiClient(runtimeConfig.public.apiBase)
const queryCache = useQueryCache()

const mobileNavigationOpen = ref(false)
const statusPopoverOpen = ref(false)
const statusQuery = useQuery(systemStatusQuery(apiClient))
const adminSessionQueryResult = useQuery(() => ({
  ...adminSessionQuery(apiClient),
  enabled: import.meta.client,
}))

const statusLoading = computed(() => statusQuery.asyncStatus.value === 'loading')
const statusError = computed(() => statusQuery.status.value === 'error')
const systemStatus = computed(() => statusQuery.data.value?.telemetry)
const apiLatencyMs = computed(() => statusQuery.data.value?.latencyMs)
const sidebarExpanded = useCookie<boolean>('eve-space-sidebar-expanded', {
  default: () => false,
  maxAge: 60 * 60 * 24 * 365,
  sameSite: 'lax',
})
const { authLoading, authSession, initializeAuth, logout } = useAuthSession(apiClient)

const pageTitle = computed(() => String(route.meta.title ?? 'Overview'))
const systemStatusState = computed(() => systemStatus.value?.status ?? 'pending')
const systemStatusLabel = computed(
  () =>
    ({
      pending: 'STATUS',
      operational: 'OPERATIONAL',
      degraded: 'DEGRADED',
      unavailable: 'UNAVAILABLE',
    })[systemStatusState.value],
)
const authorizedCharacter = computed(() =>
  authSession.value.authenticated ? authSession.value.account.mainCharacter : undefined,
)
const adminAuthenticated = computed(
  () => adminSessionQueryResult.data.value?.authenticated === true,
)
const mailUnreadQuery = useQuery(() => ({
  ...mailLabelsQuery({ apiClient, characterId: authorizedCharacter.value?.characterId ?? 0 }),
  enabled: canRunProtectedQuery(
    import.meta.client,
    authSession.value.authenticated,
    authorizedCharacter.value?.characterId,
  ),
}))
const mailUnreadCount = computed(() =>
  resolveMailUnreadCount(authorizedCharacter.value?.characterId, mailUnreadQuery.data.value),
)

onMounted(() => void initializeAuth())

watch(
  () => route.fullPath,
  () => {
    mobileNavigationOpen.value = false
  },
)
watch(statusPopoverOpen, (open) => {
  if (open) void statusQuery.refresh()
})

function prefetchSystemStatus() {
  void prefetchQuery(queryCache, systemStatusQuery(apiClient))
}

async function handleLogout() {
  mobileNavigationOpen.value = false
  await logout()
  await navigateTo('/auth')
}
</script>

<template>
  <div :class="['dashboard-shell', { 'dashboard-shell--sidebar-expanded': sidebarExpanded }]">
    <AppSidebar
      variant="persistent"
      :expanded="sidebarExpanded"
      :authenticated="authSession.authenticated"
      :admin-authenticated="adminAuthenticated"
      :auth-loading="authLoading"
      :character-id="authorizedCharacter?.characterId"
      :character-name="authorizedCharacter?.name"
      :mail-unread-count="mailUnreadCount"
      @logout="handleLogout"
      @toggle="sidebarExpanded = !sidebarExpanded"
    />

    <div :class="['dashboard-workspace', { 'character-workspace': props.hideTopbar }]">
      <!-- Standard topbar -->
      <header v-if="!props.hideTopbar" class="dashboard-topbar">
        <div class="topbar-heading">
          <UiDrawer
            v-model:open="mobileNavigationOpen"
            title="Dashboard navigation"
            description="Navigate between EVE Space dashboard sections"
          >
            <template #trigger>
              <button class="mobile-navigation-trigger" type="button" aria-label="Open navigation">
                <span aria-hidden="true" />
              </button>
            </template>

            <AppSidebar
              variant="drawer"
              :authenticated="authSession.authenticated"
              :admin-authenticated="adminAuthenticated"
              :auth-loading="authLoading"
              :character-id="authorizedCharacter?.characterId"
              :character-name="authorizedCharacter?.name"
              :mail-unread-count="mailUnreadCount"
              @navigate="mobileNavigationOpen = false"
              @logout="handleLogout"
            />
          </UiDrawer>

          <div class="topbar-title">
            <span class="topbar-kicker">EVE SPACE / OPERATIONS</span>
            <strong>{{ pageTitle }}</strong>
          </div>
        </div>
        <div class="topbar-status">
          <UiThemeSwitcher />
          <UiStatusPopover v-model:open="statusPopoverOpen">
            <template #trigger>
              <button
                class="topbar-system-status"
                type="button"
                :data-status="systemStatusState"
                @pointerenter="prefetchSystemStatus"
                @focus="prefetchSystemStatus"
              >
                <i aria-hidden="true" />
                <span class="topbar-system-status-copy">STATUS</span>
                <span class="sr-only">Open system status</span>
              </button>
            </template>

            <section class="system-status-panel" aria-live="polite">
              <header class="system-status-heading">
                <div>
                  <span>NETWORK DIAGNOSTICS</span>
                  <strong>System telemetry</strong>
                </div>
                <span :data-status="systemStatusState">{{ systemStatusLabel }}</span>
              </header>

              <div v-if="statusError" class="system-status-notice" data-status="unavailable">
                {{
                  systemStatus
                    ? 'REFRESH FAILED / DISPLAYING LAST READING'
                    : 'TELEMETRY LINK UNAVAILABLE'
                }}
                <button type="button" @click="statusQuery.refetch()">RETRY</button>
              </div>

              <div v-if="!systemStatus" class="system-status-empty">
                <span :class="{ 'system-status-pulse': statusLoading }" aria-hidden="true" />
                {{ statusLoading ? 'ESTABLISHING TELEMETRY LINK' : 'OPEN LINK TO LOAD STATUS' }}
              </div>

              <template v-else>
                <div class="system-status-services">
                  <article data-status="operational">
                    <div><i aria-hidden="true" /><strong>API GATEWAY</strong></div>
                    <span>{{ stateLabel(systemStatus.services.api.status) }}</span>
                    <dl>
                      <div>
                        <dt>NUXT / API</dt>
                        <dd>{{ apiLatencyMs ?? '--' }} MS</dd>
                      </div>
                      <div>
                        <dt>UPTIME</dt>
                        <dd>{{ formatUptime(systemStatus.services.api.uptimeSeconds) }}</dd>
                      </div>
                    </dl>
                  </article>
                  <article :data-status="systemStatus.services.database.status">
                    <div><i aria-hidden="true" /><strong>DATABASE</strong></div>
                    <span>{{ stateLabel(systemStatus.services.database.status) }}</span>
                    <dl>
                      <div>
                        <dt>QUERY</dt>
                        <dd>{{ systemStatus.services.database.latencyMs }} MS</dd>
                      </div>
                      <div>
                        <dt>CHANNEL</dt>
                        <dd>PRIMARY</dd>
                      </div>
                    </dl>
                  </article>
                  <article :data-status="systemStatus.services.esi.status">
                    <div><i aria-hidden="true" /><strong>TRANQUILITY</strong></div>
                    <span>{{ stateLabel(systemStatus.services.esi.status) }}</span>
                    <dl>
                      <div>
                        <dt>RESPONSE</dt>
                        <dd>{{ systemStatus.services.esi.latencyMs }} MS</dd>
                      </div>
                      <div>
                        <dt>ERROR BUDGET</dt>
                        <dd>{{ systemStatus.services.esi.errorBudgetRemaining ?? '--' }}</dd>
                      </div>
                    </dl>
                  </article>
                </div>

                <div class="system-status-readout">
                  <div>
                    <span>PILOTS ONLINE</span
                    ><strong>{{ formatNumber(systemStatus.services.esi.players) }}</strong>
                  </div>
                  <div>
                    <span>SERVER BUILD</span
                    ><strong>{{ systemStatus.services.esi.serverVersion ?? '--' }}</strong>
                  </div>
                  <div>
                    <span>VIP MODE</span
                    ><strong>{{
                      systemStatus.services.esi.vip === null
                        ? '--'
                        : systemStatus.services.esi.vip
                          ? 'ACTIVE'
                          : 'CLEAR'
                    }}</strong>
                  </div>
                </div>

                <footer class="system-status-footer">
                  <span>CHECKED {{ formatCheckedAt(systemStatus.checkedAt) }}</span>
                  <span :class="{ 'system-status-refreshing': statusLoading }">
                    {{ statusLoading ? 'REFRESHING' : 'REFRESH / ON OPEN' }}
                  </span>
                </footer>
              </template>
            </section>
          </UiStatusPopover>
          <NuxtLink v-if="!authLoading && !authSession.authenticated" to="/auth">SIGN IN</NuxtLink>
        </div>
      </header>

      <!-- Floating mobile trigger when topbar is hidden -->
      <UiDrawer
        v-else
        v-model:open="mobileNavigationOpen"
        title="Dashboard navigation"
        description="Navigate between EVE Space dashboard sections"
      >
        <template #trigger>
          <button class="character-mobile-nav" type="button" aria-label="Open navigation">
            <span aria-hidden="true" />
          </button>
        </template>

        <AppSidebar
          variant="drawer"
          :authenticated="authSession.authenticated"
          :admin-authenticated="adminAuthenticated"
          :auth-loading="authLoading"
          :character-id="authorizedCharacter?.characterId"
          :character-name="authorizedCharacter?.name"
          :mail-unread-count="mailUnreadCount"
          @navigate="mobileNavigationOpen = false"
          @logout="handleLogout"
        />
      </UiDrawer>

      <main :class="['dashboard-content', { 'character-content': props.hideTopbar }]">
        <slot />
      </main>
    </div>
  </div>
</template>

<style>
@import url('~/assets/css/shell/dashboard.css');
@import url('~/assets/css/responsive/dashboard.css');
</style>

<style scoped>
.character-mobile-nav {
  position: fixed;
  z-index: 9;
  top: 12px;
  left: 12px;
  width: 36px;
  height: 36px;
  display: none;
  place-items: center;
  border: 1px solid var(--line);
  border-radius: var(--ui-radius-control);
  background: color-mix(in srgb, var(--ui-canvas) 92%, transparent);
  backdrop-filter: blur(12px);
  color: var(--ui-text-muted);
  cursor: pointer;
}

.character-mobile-nav span,
.character-mobile-nav::before,
.character-mobile-nav::after {
  width: 14px;
  height: 1px;
  display: block;
  background: currentColor;
}

.character-mobile-nav::before,
.character-mobile-nav::after {
  content: '';
  position: absolute;
  left: 10px;
}

.character-mobile-nav::before {
  top: 11px;
}

.character-mobile-nav::after {
  bottom: 11px;
}

.character-mobile-nav:hover,
.character-mobile-nav:focus-visible {
  border-color: var(--accent);
  color: var(--accent);
}

@media (max-width: 760px) {
  .character-mobile-nav {
    display: grid;
  }

  .character-content {
    padding-top: 56px;
  }
}
</style>
