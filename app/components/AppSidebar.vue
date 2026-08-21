<script setup lang="ts">
const props = withDefaults(
  defineProps<{
    authenticated: boolean
    adminAuthenticated: boolean
    authLoading: boolean
    characterId?: number
    characterName?: string
    expanded?: boolean
    variant?: 'persistent' | 'drawer'
  }>(),
  {
    expanded: false,
    variant: 'persistent',
  },
)

const emit = defineEmits<{
  logout: []
  navigate: []
  toggle: []
}>()

const { characterPortrait } = useEveImages()
const visibleSections = computed(() => visibleDashboardSections(props.adminAuthenticated))
const warpDirection = ref<'expand' | 'collapse'>()
const labelsVisible = computed(() => props.expanded || warpDirection.value === 'collapse')
const accountActions = [{ value: 'logout', label: 'Log out', tone: 'danger' }] as const
const route = useRoute()
let warpTimer: ReturnType<typeof setTimeout> | undefined

function sectionIsActive(path: string) {
  return path === '/'
    ? route.path === '/'
    : route.path === path || route.path.startsWith(`${path}/`)
}

function handleLogout() {
  emit('navigate')
  emit('logout')
}

function handleAccountAction(value: string) {
  if (value === 'logout') handleLogout()
}

function handleToggle() {
  if (warpTimer) clearTimeout(warpTimer)

  if (import.meta.client && window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
    warpDirection.value = undefined
    emit('toggle')
    return
  }

  warpDirection.value = props.expanded ? 'collapse' : 'expand'
  emit('toggle')
  warpTimer = setTimeout(() => {
    warpDirection.value = undefined
  }, 520)
}

onBeforeUnmount(() => {
  if (warpTimer) clearTimeout(warpTimer)
})
</script>

<template>
  <aside
    :class="[
      'dashboard-sidebar',
      `dashboard-sidebar--${variant}`,
      {
        'dashboard-sidebar--expanded': expanded,
        'dashboard-sidebar--labels-visible': labelsVisible,
      },
      warpDirection && `dashboard-sidebar--warp-${warpDirection}`,
    ]"
  >
    <NuxtLink class="sidebar-brand" to="/" @click="$emit('navigate')">
      <span class="brand-mark" aria-hidden="true">E</span>
      <span class="sidebar-brand-copy">
        <strong>NEOCOM</strong>
        <small>CONTROL DECK</small>
      </span>
    </NuxtLink>

    <nav class="sidebar-nav" aria-label="Dashboard sections">
      <UiTooltip
        v-for="section in visibleSections"
        :key="section.to"
        :content="
          section.access === 'authorized'
            ? `${section.label} / AUTH REQUIRED`
            : section.access === 'admin'
              ? `${section.label} / OWNER ACCESS`
              : section.label
        "
        :disabled="variant === 'drawer' || labelsVisible"
        side="right"
      >
        <NuxtLink
          :to="section.to"
          class="sidebar-link"
          :class="{ 'sidebar-link--active': sectionIsActive(section.to) }"
          @click="$emit('navigate')"
        >
          <span class="sidebar-icon"><AppIcon :name="section.icon" /></span>
          <span class="sidebar-label">
            <strong>{{ section.label }}</strong>
            <small>{{ section.description }}</small>
          </span>
          <span v-if="section.access !== 'public'" class="access-mark">
            {{ section.access === 'admin' ? 'OWNER' : 'AUTH' }}
          </span>
        </NuxtLink>
      </UiTooltip>
    </nav>

    <UiTooltip
      v-if="variant === 'persistent'"
      :content="expanded ? 'Collapse navigation' : 'Expand navigation'"
      side="right"
    >
      <button
        :class="[
          'sidebar-link',
          'sidebar-toggle',
          warpDirection && `sidebar-toggle--warp-${warpDirection}`,
        ]"
        type="button"
        :aria-label="expanded ? 'Collapse navigation' : 'Expand navigation'"
        :aria-expanded="expanded"
        @click="handleToggle"
      >
        <span class="sidebar-icon" aria-hidden="true">
          <svg class="app-icon" viewBox="0 0 24 24" fill="none">
            <path :d="expanded ? 'm15 5-7 7 7 7' : 'm9 5 7 7-7 7'" />
          </svg>
        </span>
      </button>
    </UiTooltip>

    <div class="sidebar-session">
      <span v-if="authLoading" class="session-pulse">CHECKING IDENTITY</span>
      <template v-else-if="authenticated">
        <UiActionMenubar
          :label="characterName || 'Authorized pilot'"
          description="AUTHORIZED PILOT"
          :items="accountActions"
          @select="handleAccountAction"
        >
          <template #trigger>
            <button
              class="sidebar-avatar-trigger"
              type="button"
              :aria-label="`Open account menu for ${characterName || 'authorized pilot'}`"
            >
              <img
                v-if="characterId"
                :src="characterPortrait(characterId, 64)"
                :srcset="`${characterPortrait(characterId, 64)} 1x, ${characterPortrait(characterId, 128)} 2x`"
                alt=""
                width="36"
                height="36"
              />
              <span v-else class="sidebar-avatar-fallback" aria-hidden="true">
                <AppIcon name="character" />
              </span>
            </button>
          </template>
        </UiActionMenubar>
        <span class="sidebar-session-copy">
          <small>AUTHORIZED PILOT</small>
          <strong>{{ characterName }}</strong>
        </span>
      </template>
      <UiTooltip
        v-else
        content="Authorize EVE"
        :disabled="variant === 'drawer' || labelsVisible"
        side="right"
      >
        <NuxtLink class="sidebar-auth-link" to="/auth" @click="$emit('navigate')">
          <AppIcon name="auth" />
          <span>AUTHORIZE EVE</span>
        </NuxtLink>
      </UiTooltip>
    </div>
  </aside>
</template>
