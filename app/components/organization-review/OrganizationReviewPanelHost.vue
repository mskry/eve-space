<script setup lang="ts">
import type {
  PlatformReviewerPanelCatalogEntry,
  PlatformReviewerPanelComponent,
  PlatformReviewerPanelQueryAccess,
  PlatformReviewerSelectedTarget,
} from '@eve-space/platform-module-nuxt/runtime'

const props = defineProps<{
  contribution: PlatformReviewerPanelCatalogEntry
  focusRequest: number
  organizationVersion: number
  queryAccess: PlatformReviewerPanelQueryAccess
  target: PlatformReviewerSelectedTarget
}>()

const announcer = useAnnouncer()
const heading = useTemplateRef('heading')
const component = shallowRef<PlatformReviewerPanelComponent>()
const loadError = shallowRef<unknown>()
const loading = ref(false)
const renderRevision = ref(0)
let loadRevision = 0
let consumedFocusRequest = 0
let pendingFocusRequest:
  | { readonly contributionIdentity: string; readonly revision: number }
  | undefined
let focusAfterLoad = false

watch(
  contributionIdentity,
  (current) => {
    if (pendingFocusRequest?.contributionIdentity !== current) {
      consumedFocusRequest = Math.max(
        consumedFocusRequest,
        pendingFocusRequest?.revision ?? consumedFocusRequest,
      )
      pendingFocusRequest = undefined
    }
    focusAfterLoad = false
    void loadPanel()
  },
  { immediate: true },
)
watch(
  () => props.focusRequest,
  (current) => {
    if (current <= consumedFocusRequest) return
    pendingFocusRequest = {
      contributionIdentity: contributionIdentity(),
      revision: current,
    }
    void focusLoadedPanel()
  },
  { immediate: true },
)

async function loadPanel() {
  const revision = ++loadRevision
  component.value = undefined
  loadError.value = undefined
  loading.value = true
  announcer.polite(`Loading ${props.contribution.label}.`)
  try {
    const loaded = await props.contribution.load()
    if (revision !== loadRevision) return
    component.value = loaded.default
    announcer.polite(`${props.contribution.label} loaded.`)
    await focusLoadedPanel()
  } catch (error) {
    if (revision !== loadRevision) return
    loadError.value = error
    announcer.assertive(`${props.contribution.label} could not be loaded.`)
  } finally {
    if (revision === loadRevision) loading.value = false
  }
}

function retryPanel() {
  focusAfterLoad = true
  return loadPanel()
}

async function focusLoadedPanel() {
  const identity = contributionIdentity()
  const requested = pendingFocusRequest?.contributionIdentity === identity
  if (!component.value || (!requested && !focusAfterLoad)) return
  if (requested) {
    consumedFocusRequest = pendingFocusRequest!.revision
    pendingFocusRequest = undefined
  }
  focusAfterLoad = false
  await nextTick()
  if (identity === contributionIdentity() && component.value) heading.value?.focus()
}

function contributionIdentity() {
  return `${props.contribution.moduleId}/${props.contribution.contributionId}`
}

function panelProps() {
  return {
    moduleId: props.contribution.moduleId,
    contributionId: props.contribution.contributionId,
    routeId: props.contribution.routeId,
    sectionId: props.contribution.sectionId,
    organizationVersion: props.organizationVersion,
    target: props.target,
    queryAccess: props.queryAccess,
  }
}

function handleRenderError() {
  announcer.assertive(`${props.contribution.label} could not be displayed.`)
}

async function retryRender(clearError: () => void) {
  renderRevision.value += 1
  clearError()
  await nextTick()
  heading.value?.focus()
}
</script>

<template>
  <section
    class="organization-review-panel"
    :aria-labelledby="`review-panel-${contribution.contributionId}`"
  >
    <h2
      :id="`review-panel-${contribution.contributionId}`"
      ref="heading"
      class="organization-review-panel__heading"
      tabindex="-1"
    >
      {{ contribution.label }}
    </h2>
    <p class="organization-review-panel__description">{{ contribution.description }}</p>

    <output v-if="loading" class="organization-review-panel__status">
      Loading {{ contribution.label }}...
    </output>
    <div v-else-if="loadError" class="organization-review-panel__error" role="alert">
      <p>This review panel could not be loaded. No other review panel is affected.</p>
      <button class="ui-action-secondary" type="button" @click="retryPanel">RETRY PANEL</button>
    </div>
    <NuxtErrorBoundary v-else-if="component" :key="renderRevision" @error="handleRenderError">
      <component :is="component" v-bind="panelProps()" />
      <template #error="{ clearError }">
        <div class="organization-review-panel__error" role="alert">
          <p>This review panel could not be displayed. Other panels remain available.</p>
          <button class="ui-action-secondary" type="button" @click="retryRender(clearError)">
            RETRY PANEL
          </button>
        </div>
      </template>
    </NuxtErrorBoundary>
  </section>
</template>

<style scoped>
.organization-review-panel {
  min-width: 0;
  max-width: 100%;
  overflow-wrap: anywhere;
}

.organization-review-panel__heading:focus-visible,
.organization-review-panel button:focus-visible {
  outline: var(--ui-focus-ring-width) solid var(--ui-focus-ring);
  outline-offset: 3px;
}

.organization-review-panel__heading {
  margin: 0;
}

.organization-review-panel__description,
.organization-review-panel__status {
  color: var(--ui-text-muted);
}

.organization-review-panel__status {
  display: block;
}

.organization-review-panel__error {
  padding: 1rem;
  border: 1px solid var(--ui-danger);
}
</style>
