<script setup lang="ts">
import { useQuery, useQueryCache } from '@pinia/colada'
import { adminSessionQuery } from '../queries/admin'
import { prefetchQuery } from '../queries/query-cache'
import { systemStatusQuery } from '../queries/system-status'

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

function formatNumber(value: number | null) {
  return value === null ? '--' : new Intl.NumberFormat('en-US').format(value)
}

function formatUptime(seconds: number) {
  const days = Math.floor(seconds / 86_400)
  const hours = Math.floor((seconds % 86_400) / 3_600)
  return days > 0 ? `${days}D ${hours}H` : `${hours}H ${Math.floor((seconds % 3_600) / 60)}M`
}

function formatCheckedAt(value: string) {
  return new Date(value).toLocaleTimeString('en-GB', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  })
}

function stateLabel(value: string) {
  return value.toUpperCase()
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
      @logout="handleLogout"
      @toggle="sidebarExpanded = !sidebarExpanded"
    />

    <div class="dashboard-workspace">
      <header class="dashboard-topbar">
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

      <main class="dashboard-content">
        <slot />
      </main>
    </div>
  </div>
</template>
