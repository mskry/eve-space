<script setup lang="ts">
import { usePlatformNavigation } from '#imports'
import { resolveShellSectionPath } from '../utils/dashboard-sections'
import { mailUnreadBadgeValue, resolveMailUnreadBadge } from '../utils/mail-unread-badge'

const props = withDefaults(
  defineProps<{
    authenticated: boolean
    adminAuthenticated: boolean
    authLoading: boolean
    authUnavailable?: boolean
    characterId?: number
    characterName?: string
    expanded?: boolean
    mailUnreadCount?: number
    variant?: 'persistent' | 'drawer'
  }>(),
  {
    authUnavailable: false,
    expanded: false,
    variant: 'persistent',
  },
)

const emit = defineEmits<{
  logout: []
  navigate: [path: string]
  toggle: []
}>()

const { navigation: dashboardNavigation } = usePlatformNavigation('dashboard')
const visibleSections = computed(() =>
  dashboardNavigation.value
    .filter((section) => section.audience !== 'admin' || props.adminAuthenticated)
    .map((section) => ({
      access: section.audience === 'authenticated' ? 'authorized' : section.audience,
      badge: section.navigationId === 'core-mail' ? mailBadge.value : undefined,
      description: section.description,
      icon: section.icon,
      label: section.label,
      navigationId: section.navigationId,
      ownerId: section.ownerId,
      to: resolveShellSectionPath(section.to, props.characterId),
    })),
)
const sidebarOrderKey = 'eve-space-dashboard-sidebar-order'
const sectionOrder = ref<string[]>([])
const draggedSectionId = ref<string>()
const dropTargetId = ref<string>()
const reorderAnnouncement = ref('')
const sectionKey = (section: { ownerId: string; navigationId: string }) =>
  `${section.ownerId}/${section.navigationId}`
const orderedSections = computed(() => {
  if (props.variant !== 'persistent' || sectionOrder.value.length === 0) {
    return visibleSections.value
  }

  const positions = new Map(sectionOrder.value.map((id, index) => [id, index]))
  return visibleSections.value.toSorted((left, right) => {
    const leftPosition = positions.get(sectionKey(left)) ?? sectionOrder.value.length
    const rightPosition = positions.get(sectionKey(right)) ?? sectionOrder.value.length
    return leftPosition - rightPosition
  })
})
const mailBadge = computed(() => resolveMailUnreadBadge(props.characterId, props.mailUnreadCount))
const warpDirection = ref<'expand' | 'collapse'>()
const labelsVisible = computed(() => props.expanded || warpDirection.value === 'collapse')
const accountActions = [{ label: 'Log out', tone: 'danger', value: 'logout' }] as const
const route = useRoute()
let warpTimer: ReturnType<typeof setTimeout> | undefined

onMounted(() => {
  if (props.variant !== 'persistent') {
    return
  }
  try {
    const stored = JSON.parse(globalThis.localStorage.getItem(sidebarOrderKey) ?? '[]')
    if (Array.isArray(stored)) {
      sectionOrder.value = [...new Set(stored.filter((id): id is string => typeof id === 'string'))]
    }
  } catch {
    sectionOrder.value = []
  }
})

// Shell destinations can nest (/characters and /characters/7/mail); only the
// most specific match may present itself as the current section.
const activeSectionId = computed(() => {
  const matches = visibleSections.value
    .filter((section) =>
      section.to === '/'
        ? route.path === '/'
        : route.path === section.to || route.path.startsWith(`${section.to}/`),
    )
    .toSorted((left, right) => right.to.length - left.to.length)
  const active = matches[0]
  return active ? `${active.ownerId}/${active.navigationId}` : undefined
})

function sectionIsActive(ownerId: string, navigationId: string) {
  return activeSectionId.value === `${ownerId}/${navigationId}`
}

const handleSectionClick = (
  event: MouseEvent,
  navigate: (event: MouseEvent) => void,
  path: string,
) => {
  navigate(event)
  emit('navigate', path)
}

const moveSection = (sourceId: string, targetId: string, after: boolean) => {
  if (props.variant !== 'persistent' || sourceId === targetId) {
    return
  }
  const order = [...new Set([...sectionOrder.value, ...dashboardNavigation.value.map(sectionKey)])]
  const sourceIndex = order.indexOf(sourceId)
  if (sourceIndex === -1 || !order.includes(targetId)) {
    return
  }
  order.splice(sourceIndex, 1)
  order.splice(order.indexOf(targetId) + Number(after), 0, sourceId)
  sectionOrder.value = order
  const section = orderedSections.value.find((candidate) => sectionKey(candidate) === sourceId)
  const position = orderedSections.value.findIndex(
    (candidate) => sectionKey(candidate) === sourceId,
  )
  if (section && position !== -1) {
    reorderAnnouncement.value = `${section.label} moved to position ${position + 1} of ${orderedSections.value.length}`
  }
  try {
    globalThis.localStorage.setItem(sidebarOrderKey, JSON.stringify(order))
  } catch {
    return
  }
}

const handleSectionKeydown = (event: KeyboardEvent, id: string) => {
  if (
    props.variant !== 'persistent' ||
    !event.altKey ||
    !['ArrowUp', 'ArrowDown'].includes(event.key)
  ) {
    return
  }
  event.preventDefault()
  const index = orderedSections.value.findIndex((section) => sectionKey(section) === id)
  const target = orderedSections.value[index + (event.key === 'ArrowUp' ? -1 : 1)]
  if (target) {
    moveSection(id, sectionKey(target), event.key === 'ArrowDown')
  }
}

const handleSectionDragStart = (event: DragEvent, id: string) => {
  if (props.variant !== 'persistent') {
    return
  }
  draggedSectionId.value = id
  event.dataTransfer?.setData('text/plain', id)
  if (event.dataTransfer) {
    event.dataTransfer.effectAllowed = 'move'
  }
}

const handleSectionDragOver = (event: DragEvent, id: string) => {
  if (!draggedSectionId.value || draggedSectionId.value === id) {
    return
  }
  event.preventDefault()
  dropTargetId.value = id
  if (event.dataTransfer) {
    event.dataTransfer.dropEffect = 'move'
  }
}

const handleSectionDrop = (event: DragEvent, id: string) => {
  event.preventDefault()
  if (draggedSectionId.value && event.currentTarget instanceof HTMLElement) {
    const bounds = event.currentTarget.getBoundingClientRect()
    moveSection(
      draggedSectionId.value,
      id,
      bounds.height > 0 && event.clientY >= bounds.top + bounds.height / 2,
    )
  }
  draggedSectionId.value = undefined
  dropTargetId.value = undefined
}

const handleSectionDragEnd = () => {
  draggedSectionId.value = undefined
  dropTargetId.value = undefined
}

function handleLogout() {
  emit('navigate', '/auth')
  emit('logout')
}

function handleAccountAction(value: string) {
  if (value === 'logout') {
    handleLogout()
  }
}

function handleToggle() {
  if (warpTimer) {
    clearTimeout(warpTimer)
  }

  if (import.meta.client && globalThis.matchMedia('(prefers-reduced-motion: reduce)').matches) {
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
  if (warpTimer) {
    clearTimeout(warpTimer)
  }
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
    <NuxtLink class="sidebar-brand" to="/" @click="$emit('navigate', '/')">
      <span class="brand-mark" aria-hidden="true">E</span>
      <span class="sidebar-brand-copy">
        <strong>NEOCOM</strong>
        <small>CONTROL DECK</small>
      </span>
    </NuxtLink>

    <nav class="sidebar-nav" aria-label="Dashboard sections">
      <div
        v-for="section in orderedSections"
        :key="sectionKey(section)"
        class="sidebar-nav-item"
        :class="{
          'sidebar-nav-item--dragging': draggedSectionId === sectionKey(section),
          'sidebar-nav-item--drop-target': dropTargetId === sectionKey(section),
        }"
        :draggable="variant === 'persistent'"
        @dragstart="handleSectionDragStart($event, sectionKey(section))"
        @dragover="handleSectionDragOver($event, sectionKey(section))"
        @drop="handleSectionDrop($event, sectionKey(section))"
        @dragend="handleSectionDragEnd"
      >
        <NuxtLink v-slot="{ navigate, prefetch, isExactActive }" :to="section.to" custom>
          <UiTooltip
            :content="
              section.access === 'authorized'
                ? `${section.label}`
                : section.access === 'admin'
                  ? `${section.label}`
                  : section.label
            "
            :disabled="variant === 'drawer' || labelsVisible"
            side="right"
          >
            <a
              :href="section.to"
              :draggable="false"
              class="sidebar-link"
              :class="{
                'sidebar-link--active': sectionIsActive(section.ownerId, section.navigationId),
              }"
              :aria-current="isExactActive ? 'page' : undefined"
              :aria-keyshortcuts="
                variant === 'persistent' ? 'Alt+ArrowUp Alt+ArrowDown' : undefined
              "
              :aria-description="
                variant === 'persistent'
                  ? 'Drag to reorder, or press Alt+Up or Alt+Down'
                  : undefined
              "
              @click="handleSectionClick($event, navigate, section.to)"
              @keydown="handleSectionKeydown($event, sectionKey(section))"
              @pointerenter="prefetch()"
              @focus="prefetch()"
            >
              <span class="sidebar-icon">
                <AppIcon :name="section.icon" />
                <span v-if="section.badge" class="sidebar-badge">
                  <span aria-hidden="true">{{ mailUnreadBadgeValue(section.badge.count) }}</span>
                  <span class="sr-only">{{ section.badge.label }}</span>
                </span>
              </span>
              <span class="sidebar-label">
                <strong>{{ section.label }}</strong>
                <small>{{ section.description }}</small>
              </span>
            </a>
          </UiTooltip>
        </NuxtLink>
      </div>
    </nav>
    <output v-if="variant === 'persistent'" class="sr-only" aria-live="polite">{{
      reorderAnnouncement
    }}</output>

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
      <span v-if="authUnavailable" class="session-pulse">IDENTITY UNAVAILABLE</span>
      <span v-else-if="authLoading" class="session-pulse">CHECKING IDENTITY</span>
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
              <UiEveImage
                v-if="characterId"
                kind="character"
                :id="characterId"
                :dimension="36"
                alt=""
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
        <NuxtLink class="sidebar-auth-link" to="/auth" @click="$emit('navigate', '/auth')">
          <AppIcon name="auth" />
          <span>AUTHORIZE EVE</span>
        </NuxtLink>
      </UiTooltip>
    </div>
  </aside>
</template>
