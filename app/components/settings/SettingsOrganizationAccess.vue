<script setup lang="ts">
import type {
  OrganizationContext,
  OrganizationOwnerQueryAccess,
  OrganizationPermissionBundles,
  OrganizationPermissionCatalog,
} from '../../queries/organization'
import {
  organizationPermissionBundlesQuery,
  organizationPermissionCatalogQuery,
} from '../../queries/organization'
import { refreshPrivateAuthorization } from '../../queries/query-cache'
import { reportPrivateQueryAuthorizationDenial } from '../../query-persistence/runtime'
import { toApiQueryError } from '../../utils/query-error'

const props = defineProps<{
  authenticated: boolean
  context: OrganizationContext
  invalidationRevision: number
}>()

type CatalogPermission = OrganizationPermissionCatalog['permissions'][number]
type CatalogProfile = OrganizationPermissionCatalog['profiles'][number]
type PermissionBundle = OrganizationPermissionBundles['bundles'][number]
type BundlePermission = PermissionBundle['permissions'][number]

type DraftPermission =
  | {
      type: 'module'
      entryId?: string
      publisherPackage: string | null
      moduleId: string | null
      key: string
      available: boolean
      label?: string
      purpose?: string
    }
  | {
      type: 'service'
      key: string
      reviewAllowed: boolean
    }

type PermissionSelection =
  | { type: 'module'; publisherPackage: string; moduleId: string; key: string }
  | { type: 'service'; key: string; reviewAllowed: boolean }

interface DraftBundle {
  bundleId: string | null
  name: string
  reason: string
  permissions: DraftPermission[]
}

interface CatalogGroup {
  publisherPackage: string
  moduleId: string
  permissions: CatalogPermission[]
  profiles: CatalogProfile[]
}

const runtimeConfig = useRuntimeConfig()
const apiClient = createApiClient(runtimeConfig.public.apiBase)
const queryCache = useQueryCache()
const access = computed<OrganizationOwnerQueryAccess>(() => ({
  authenticated: props.authenticated,
  blocked: props.context.isBlocked,
  isOrganizationOwner: props.context.isOrganizationOwner,
  memberAccess: props.context.memberAccess,
}))
const canManage = computed(
  () =>
    access.value.authenticated &&
    access.value.isOrganizationOwner &&
    access.value.memberAccess &&
    !access.value.blocked,
)
const organizationVersion = computed(() => props.context.organization.organizationVersion)
const catalogQuery = useQuery(() =>
  organizationPermissionCatalogQuery({
    access: access.value,
    apiClient,
    organizationVersion: organizationVersion.value,
  }),
)
const bundlesQuery = useQuery(() =>
  organizationPermissionBundlesQuery({
    access: access.value,
    apiClient,
    organizationVersion: organizationVersion.value,
  }),
)
const previewMutation = useMutation({
  mutation: async (profile: CatalogProfile) => {
    const response = await apiClient.api.organization['permission-profile-preview'].$post({
      json: {
        moduleId: profile.moduleId,
        profileId: profile.id,
        publisherPackage: profile.publisherPackage,
      },
    })
    if (response.status !== 200) {
      throw await toApiQueryError(response, 'Permission profile preview is unavailable.')
    }
    return response.json()
  },
})
const saveMutation = useMutation({
  mutation: async (input: {
    bundleId: string | null
    name: string
    reason: string
    permissions: PermissionSelection[]
    retainedUnavailableEntryIds: string[]
  }) => {
    if (input.bundleId) {
      const response = await apiClient.api.organization['permission-bundles'][':bundleId'].$put({
        json: {
          name: input.name,
          permissions: input.permissions,
          reason: input.reason,
          retainedUnavailableEntryIds: input.retainedUnavailableEntryIds,
        },
        param: { bundleId: input.bundleId },
      })
      if (response.status !== 200) {
        throw await toApiQueryError(response, 'Permission bundle could not be updated.')
      }
      return { created: false, result: await response.json() }
    }
    const response = await apiClient.api.organization['permission-bundles'].$post({
      json: { name: input.name, permissions: input.permissions, reason: input.reason },
    })
    if (response.status !== 201) {
      throw await toApiQueryError(response, 'Permission bundle could not be created.')
    }
    return { created: true, result: await response.json() }
  },
})

const catalog = shallowRef<OrganizationPermissionCatalog>()
const bundles = shallowRef<OrganizationPermissionBundles>()
const draft = ref<DraftBundle | null>(null)
const profileDialogOpen = ref(false)
const selectedProfile = shallowRef<CatalogProfile>()
const profilePreview = shallowRef<Awaited<ReturnType<typeof previewMutation.mutateAsync>>>()
const pendingUnavailableRemoval = ref('')
const cleanupConfirmationOpen = ref(false)
const statusMessage = ref('')
const actionError = shallowRef<unknown>()
const operationRevision = ref(0)

const catalogGroups = computed<CatalogGroup[]>(() => {
  const groups = new Map<string, CatalogGroup>()
  for (const permission of catalog.value?.permissions ?? []) {
    const group = catalogGroup(groups, permission.publisherPackage, permission.moduleId)
    group.permissions.push(permission)
  }
  for (const profile of catalog.value?.profiles ?? []) {
    const group = catalogGroup(groups, profile.publisherPackage, profile.moduleId)
    group.profiles.push(profile)
  }
  return [...groups.values()].toSorted((left, right) =>
    `${left.moduleId}\u0000${left.publisherPackage}`.localeCompare(
      `${right.moduleId}\u0000${right.publisherPackage}`,
    ),
  )
})
const servicePermissions = computed(() =>
  draft.value?.permissions.filter((permission) => permission.type === 'service'),
)
const unavailablePermissions = computed(() =>
  draft.value?.permissions.filter(
    (permission) => permission.type === 'module' && !permission.available,
  ),
)
const saving = computed(() => saveMutation.asyncStatus.value === 'loading')
const loading = computed(
  () =>
    catalogQuery.asyncStatus.value === 'loading' || bundlesQuery.asyncStatus.value === 'loading',
)
const errorMessage = computed(() => {
  const error =
    actionError.value ??
    previewMutation.error.value ??
    saveMutation.error.value ??
    catalogQuery.error.value ??
    bundlesQuery.error.value
  return error instanceof Error ? error.message : ''
})
const profileDialogTitle = computed(() => selectedProfile.value?.label ?? 'Permission profile')

watch(
  [() => catalogQuery.data.value, () => catalogQuery.asyncStatus.value],
  ([value, status]) => {
    if (status !== 'loading' && canManage.value) {
      catalog.value = value
    }
  },
  { immediate: true },
)
watch(
  [() => bundlesQuery.data.value, () => bundlesQuery.asyncStatus.value],
  ([value, status]) => {
    if (status !== 'loading' && canManage.value) {
      bundles.value = value
    }
  },
  { immediate: true },
)
watch(() => props.invalidationRevision, resetSensitiveState, { flush: 'sync' })
watch(organizationVersion, resetSensitiveState, { flush: 'sync' })
watch(
  canManage,
  (allowed) => {
    if (!allowed) {
      resetSensitiveState()
    }
  },
  { flush: 'sync' },
)
onUnmounted(() => {
  operationRevision.value += 1
})

function catalogGroup(
  groups: Map<string, CatalogGroup>,
  publisherPackage: string,
  moduleId: string,
) {
  const identity = `${publisherPackage}\u0000${moduleId}`
  const existing = groups.get(identity)
  if (existing) {
    return existing
  }
  const group = { moduleId, permissions: [], profiles: [], publisherPackage }
  groups.set(identity, group)
  return group
}

function startCreate() {
  clearActionState()
  draft.value = { bundleId: null, name: '', permissions: [], reason: '' }
}

function startEdit(bundle: PermissionBundle) {
  clearActionState()
  draft.value = {
    bundleId: bundle.bundleId,
    name: bundle.name,
    permissions: bundle.permissions.map(copyBundlePermission),
    reason: '',
  }
}

function copyBundlePermission(permission: BundlePermission): DraftPermission {
  if (permission.type === 'service') {
    return {
      key: permission.key,
      reviewAllowed: permission.reviewAllowed,
      type: 'service',
    }
  }
  return {
    available: permission.available,
    entryId: permission.entryId,
    key: permission.key,
    moduleId: permission.moduleId,
    publisherPackage: permission.publisherPackage,
    type: 'module',
    ...('label' in permission ? { label: permission.label, purpose: permission.purpose } : {}),
  }
}

function cancelDraft() {
  draft.value = null
  clearActionState()
}

function permissionSelected(permission: CatalogPermission) {
  return Boolean(
    draft.value?.permissions.some(
      (entry) => entry.type === 'module' && sameModulePermission(entry, permission),
    ),
  )
}

function togglePermission(permission: CatalogPermission, selected: boolean) {
  if (!draft.value) {
    return
  }
  clearActionState()
  draft.value.permissions = draft.value.permissions.filter(
    (entry) => entry.type !== 'module' || !sameModulePermission(entry, permission),
  )
  if (selected) {
    draft.value.permissions.push(catalogDraftPermission(permission))
  }
}

async function previewProfile(profile: CatalogProfile) {
  selectedProfile.value = profile
  profilePreview.value = undefined
  actionError.value = undefined
  previewMutation.reset()
  const revision = operationRevision.value
  try {
    const result = await previewMutation.mutateAsync(profile)
    if (revision !== operationRevision.value || !canManage.value) {
      return
    }
    profilePreview.value = result
  } catch (error) {
    if (revision !== operationRevision.value) {
      return
    }
    reportPrivateQueryAuthorizationDenial(queryCache, { kind: 'organization' }, error)
    actionError.value = error
  }
}

function copyProfileToDraft() {
  if (!profilePreview.value) {
    return
  }
  if (!draft.value) {
    startCreate()
  }
  const currentDraft = draft.value
  if (!currentDraft) {
    return
  }
  const { publisherPackage, moduleId } = profilePreview.value.profile
  currentDraft.permissions = currentDraft.permissions.filter(
    (permission) =>
      permission.type !== 'module' ||
      !permission.available ||
      permission.publisherPackage !== publisherPackage ||
      permission.moduleId !== moduleId,
  )
  currentDraft.permissions.push(
    ...profilePreview.value.permissions.map((permission) => catalogDraftPermission(permission)),
  )
  statusMessage.value = `${profilePreview.value.profile.label} copied to the local bundle draft.`
  actionError.value = undefined
  profileDialogOpen.value = false
}

function requestUnavailableRemoval(permission: DraftPermission) {
  pendingUnavailableRemoval.value = draftPermissionIdentity(permission)
}

function confirmUnavailableRemoval() {
  if (!draft.value || !pendingUnavailableRemoval.value) {
    return
  }
  draft.value.permissions = draft.value.permissions.filter(
    (permission) => draftPermissionIdentity(permission) !== pendingUnavailableRemoval.value,
  )
  pendingUnavailableRemoval.value = ''
  statusMessage.value = 'Unavailable permission removed from the local draft.'
}

function removeServicePermission(permission: DraftPermission) {
  if (!draft.value) {
    return
  }
  draft.value.permissions = draft.value.permissions.filter(
    (entry) => draftPermissionIdentity(entry) !== draftPermissionIdentity(permission),
  )
}

function requestSave() {
  if (draft.value?.bundleId && draft.value.permissions.length === 0) {
    cleanupConfirmationOpen.value = true
    return
  }
  void saveDraft()
}

async function saveDraft() {
  const currentDraft = draft.value
  if (!currentDraft || saving.value) {
    return
  }
  const name = currentDraft.name.trim()
  const reason = currentDraft.reason.trim()
  actionError.value = undefined
  statusMessage.value = ''
  if (!name || !reason) {
    actionError.value = new Error('Bundle name and reason are required.')
    return
  }
  if (!currentDraft.bundleId && currentDraft.permissions.length === 0) {
    actionError.value = new Error('Select at least one permission before creating a bundle.')
    return
  }
  const permissions = permissionSelections(currentDraft.permissions)
  if (
    currentDraft.permissions.some(
      (permission) => permission.type === 'module' && !permission.available && !permission.entryId,
    )
  ) {
    actionError.value = new Error('Reload the bundle before saving retained permissions.')
    return
  }
  const retainedUnavailableEntryIds = currentDraft.permissions.flatMap((permission) =>
    permission.type === 'module' && !permission.available && permission.entryId
      ? [permission.entryId]
      : [],
  )
  const revision = operationRevision.value
  const cleanup =
    Boolean(currentDraft.bundleId) &&
    permissions.length === 0 &&
    retainedUnavailableEntryIds.length === 0
  try {
    const saved = await saveMutation.mutateAsync({
      bundleId: currentDraft.bundleId,
      name,
      permissions,
      reason,
      retainedUnavailableEntryIds,
    })
    if (revision !== operationRevision.value || !canManage.value) {
      return
    }
    draft.value = null
    cleanupConfirmationOpen.value = false
    await refreshPrivateAuthorization(queryCache, { kind: 'organization' })
    if (!canManage.value) {
      return
    }
    const savedStatus = saved.created ? 'Permission bundle created.' : 'Permission bundle updated.'
    statusMessage.value = cleanup ? 'Permission bundle cleanup saved.' : savedStatus
  } catch (error) {
    if (revision !== operationRevision.value) {
      return
    }
    reportPrivateQueryAuthorizationDenial(queryCache, { kind: 'organization' }, error)
    actionError.value = error
  }
}

function permissionSelections(permissions: DraftPermission[]): PermissionSelection[] {
  const selections: PermissionSelection[] = []
  for (const permission of permissions) {
    if (permission.type === 'service') {
      selections.push({
        key: permission.key,
        reviewAllowed: permission.reviewAllowed,
        type: 'service',
      })
      continue
    }
    if (!permission.available || !permission.publisherPackage || !permission.moduleId) {
      continue
    }
    selections.push({
      key: permission.key,
      moduleId: permission.moduleId,
      publisherPackage: permission.publisherPackage,
      type: 'module',
    })
  }
  return selections
}

function sameProfile(left: CatalogProfile | undefined, right: CatalogProfile) {
  return (
    left?.publisherPackage === right.publisherPackage &&
    left.moduleId === right.moduleId &&
    left.id === right.id
  )
}

function catalogDraftPermission(permission: CatalogPermission): DraftPermission {
  return {
    available: true,
    key: permission.key,
    label: permission.label,
    moduleId: permission.moduleId,
    publisherPackage: permission.publisherPackage,
    purpose: permission.purpose,
    type: 'module',
  }
}

function sameModulePermission(
  left: { publisherPackage: string | null; moduleId: string | null; key: string },
  right: Pick<CatalogPermission, 'publisherPackage' | 'moduleId' | 'key'>,
) {
  return (
    left.publisherPackage === right.publisherPackage &&
    left.moduleId === right.moduleId &&
    left.key === right.key
  )
}

function draftPermissionIdentity(permission: DraftPermission) {
  return permission.type === 'service'
    ? `service\u0000${permission.key}`
    : `module\u0000${permission.publisherPackage ?? ''}\u0000${permission.moduleId ?? ''}\u0000${permission.key}`
}

function audienceLabel(audiences: readonly string[]) {
  return audiences.join(', ')
}

function reviewPolicyLabel(reviewAllowed: boolean) {
  return reviewAllowed ? 'Allowed during compliance review' : 'Unavailable during compliance review'
}

function originalOwnerLabel(permission: DraftPermission) {
  if (permission.type !== 'module') {
    return ''
  }
  if (!permission.publisherPackage || !permission.moduleId) {
    return 'Unknown legacy owner'
  }
  return `${permission.publisherPackage} / ${permission.moduleId}`
}

function bundlePermissionIdentity(permission: BundlePermission) {
  return draftPermissionIdentity(copyBundlePermission(permission))
}

function bundlePermissionOwnerLabel(permission: BundlePermission) {
  return originalOwnerLabel(copyBundlePermission(permission))
}

function setProfileDialogOpen(profile: CatalogProfile, open: boolean) {
  if (open) {
    profileDialogOpen.value = true
    selectedProfile.value = profile
    return
  }
  profileDialogOpen.value = false
}

function clearActionState() {
  pendingUnavailableRemoval.value = ''
  cleanupConfirmationOpen.value = false
  statusMessage.value = ''
  actionError.value = undefined
  saveMutation.reset()
}

function resetSensitiveState() {
  operationRevision.value += 1
  catalog.value = undefined
  bundles.value = undefined
  draft.value = null
  profileDialogOpen.value = false
  selectedProfile.value = undefined
  profilePreview.value = undefined
  pendingUnavailableRemoval.value = ''
  cleanupConfirmationOpen.value = false
  statusMessage.value = ''
  actionError.value = undefined
  previewMutation.reset()
  saveMutation.reset()
}
</script>

<template>
  <section
    class="settings-subsection organization-access"
    aria-labelledby="organization-access-heading"
  >
    <header class="settings-subsection-heading">
      <div>
        <p class="ui-eyebrow">03 / PERMISSION BUNDLES</p>
        <h2 id="organization-access-heading">Organization access</h2>
      </div>
      <p>Deliberate, audited access assembled from permissions declared by enabled modules.</p>
    </header>

    <p class="sr-only" aria-live="polite">{{ statusMessage }}</p>
    <p v-if="errorMessage" class="ui-inline-error" role="alert">{{ errorMessage }}</p>
    <p v-if="loading && !catalog" class="organization-access__loading">
      Loading permission catalog and bundles...
    </p>

    <div v-if="catalog" class="organization-access__catalog">
      <div class="organization-access__panel-heading">
        <div>
          <span class="authority-step">CURRENT CATALOG</span>
          <h3>Enabled module permissions</h3>
        </div>
        <button
          class="ui-action-primary"
          type="button"
          :disabled="Boolean(draft)"
          @click="startCreate"
        >
          NEW BUNDLE
        </button>
      </div>

      <p v-if="catalogGroups.length === 0" class="organization-access__empty">
        No enabled module permissions are currently declared.
      </p>
      <article
        v-for="group in catalogGroups"
        :key="`${group.publisherPackage}:${group.moduleId}`"
        class="organization-access__module"
      >
        <header>
          <h3>{{ group.moduleId }}</h3>
          <p>{{ group.publisherPackage }}</p>
        </header>

        <fieldset class="organization-access__permissions">
          <legend>Permissions</legend>
          <label
            v-for="permission in group.permissions"
            :key="permission.key"
            class="organization-access__permission"
          >
            <input
              type="checkbox"
              :checked="permissionSelected(permission)"
              :disabled="!draft"
              @change="togglePermission(permission, ($event.target as HTMLInputElement).checked)"
            />
            <span>
              <strong>{{ permission.label }}</strong>
              <code>{{ permission.key }}</code>
              <span>{{ permission.purpose }}</span>
              <dl>
                <div>
                  <dt>Eligible audiences</dt>
                  <dd>{{ audienceLabel(permission.audiences) }}</dd>
                </div>
                <div>
                  <dt>Sensitivity</dt>
                  <dd>{{ permission.sensitivity }}</dd>
                </div>
                <div>
                  <dt>Review-period policy</dt>
                  <dd>{{ reviewPolicyLabel(permission.reviewAllowed) }}</dd>
                </div>
              </dl>
            </span>
          </label>
        </fieldset>

        <div v-if="group.profiles.length > 0" class="organization-access__profiles">
          <h4>Suggested profiles</h4>
          <UiDialog
            v-for="profile in group.profiles"
            :key="profile.id"
            :open="profileDialogOpen && sameProfile(selectedProfile, profile)"
            class="organization-profile-dialog"
            :title="profileDialogTitle"
            description="Review the current exact suggestion before copying it to a local bundle draft."
            @update:open="setProfileDialogOpen(profile, $event)"
          >
            <template #trigger>
              <button
                class="ui-action-secondary organization-access__profile-trigger"
                type="button"
                @click="previewProfile(profile)"
              >
                PREVIEW {{ profile.label }}
              </button>
            </template>

            <div v-if="sameProfile(selectedProfile, profile)" class="organization-profile-preview">
              <p v-if="previewMutation.asyncStatus.value === 'loading'">Loading profile...</p>
              <template v-else-if="profilePreview">
                <p>{{ profilePreview.profile.description }}</p>
                <dl>
                  <div>
                    <dt>Recommended audiences</dt>
                    <dd>{{ audienceLabel(profilePreview.profile.audiences) }}</dd>
                  </div>
                  <div>
                    <dt>Publisher and module</dt>
                    <dd>
                      {{ profilePreview.profile.publisherPackage }} /
                      {{ profilePreview.profile.moduleId }}
                    </dd>
                  </div>
                </dl>
                <h4>Exact permissions</h4>
                <ul>
                  <li v-for="permission in profilePreview.permissions" :key="permission.key">
                    <strong>{{ permission.label }}</strong>
                    <code>{{ permission.key }}</code>
                  </li>
                </ul>
                <p class="organization-profile-preview__warning">
                  This suggestion grants no role, group, assignment, or access automatically.
                </p>
                <button class="ui-action-primary" type="button" @click="copyProfileToDraft">
                  COPY TO BUNDLE DRAFT
                </button>
              </template>
            </div>
          </UiDialog>
        </div>
      </article>
    </div>

    <form v-if="draft" class="organization-access__draft" @submit.prevent="requestSave">
      <div class="organization-access__panel-heading">
        <div>
          <span class="authority-step">LOCAL DRAFT</span>
          <h3>{{ draft.bundleId ? 'Edit permission bundle' : 'Create permission bundle' }}</h3>
        </div>
        <button class="ui-action-secondary" type="button" :disabled="saving" @click="cancelDraft">
          CANCEL
        </button>
      </div>

      <label>
        <span>Bundle name</span>
        <input v-model="draft.name" type="text" maxlength="100" required />
      </label>
      <label>
        <span>Reason for this change</span>
        <textarea v-model="draft.reason" maxlength="2000" required></textarea>
      </label>

      <fieldset v-if="servicePermissions?.length" class="organization-access__retained">
        <legend>External service permissions</legend>
        <article v-for="permission in servicePermissions" :key="permission.key">
          <div>
            <strong>{{ permission.key }}</strong>
            <p>{{ reviewPolicyLabel(permission.reviewAllowed) }}</p>
          </div>
          <button
            class="ui-action-secondary"
            type="button"
            @click="removeServicePermission(permission)"
          >
            REMOVE FROM DRAFT
          </button>
        </article>
      </fieldset>

      <fieldset v-if="unavailablePermissions?.length" class="organization-access__retained">
        <legend>Retained unavailable module permissions</legend>
        <article
          v-for="permission in unavailablePermissions"
          :key="draftPermissionIdentity(permission)"
          class="organization-access__unavailable"
        >
          <div>
            <strong>Unavailable - grants no access</strong>
            <code>{{ permission.key }}</code>
            <dl>
              <div>
                <dt>Original owner</dt>
                <dd>{{ originalOwnerLabel(permission) }}</dd>
              </div>
            </dl>
          </div>
          <div>
            <template v-if="pendingUnavailableRemoval === draftPermissionIdentity(permission)">
              <p>Remove this retained permission from the local draft?</p>
              <button class="ui-action-primary" type="button" @click="confirmUnavailableRemoval">
                CONFIRM REMOVAL
              </button>
              <button
                class="ui-action-secondary"
                type="button"
                @click="pendingUnavailableRemoval = ''"
              >
                KEEP ENTRY
              </button>
            </template>
            <button
              v-else
              class="ui-action-secondary"
              type="button"
              @click="requestUnavailableRemoval(permission)"
            >
              REMOVE FROM DRAFT
            </button>
          </div>
        </article>
      </fieldset>

      <div v-if="cleanupConfirmationOpen" class="organization-access__cleanup-confirmation">
        <strong>Save this bundle with no permissions?</strong>
        <p>This explicitly cleans up every permission currently stored in the bundle.</p>
        <button class="ui-action-primary" type="button" :disabled="saving" @click="saveDraft">
          CONFIRM EMPTY BUNDLE
        </button>
        <button class="ui-action-secondary" type="button" @click="cleanupConfirmationOpen = false">
          CANCEL CLEANUP
        </button>
      </div>
      <button v-else class="ui-action-primary" type="submit" :disabled="saving">
        {{ saving ? 'SAVING...' : draft.bundleId ? 'SAVE FULL REPLACEMENT' : 'CREATE BUNDLE' }}
      </button>
    </form>

    <section
      v-if="bundles"
      class="organization-access__bundles"
      aria-labelledby="bundle-list-heading"
    >
      <div class="organization-access__panel-heading">
        <div>
          <span class="authority-step">CURRENT CONFIGURATION</span>
          <h3 id="bundle-list-heading">Permission bundles</h3>
        </div>
      </div>
      <p v-if="bundles.bundles.length === 0" class="organization-access__empty">
        No permission bundles exist for this organization version.
      </p>
      <article
        v-for="bundle in bundles.bundles"
        :key="bundle.bundleId"
        class="organization-access__bundle"
      >
        <div>
          <h4>{{ bundle.name }}</h4>
          <p>{{ bundle.permissions.length }} permission entries</p>
        </div>
        <button
          class="ui-action-secondary"
          type="button"
          :disabled="Boolean(draft)"
          @click="startEdit(bundle)"
        >
          EDIT BUNDLE
        </button>
        <ul>
          <li v-for="permission in bundle.permissions" :key="bundlePermissionIdentity(permission)">
            <code>{{ permission.key }}</code>
            <span v-if="permission.type === 'service'">External service</span>
            <span v-else-if="permission.available">
              {{ permission.publisherPackage }} / {{ permission.moduleId }}
            </span>
            <span v-else>
              Unavailable - grants no access / {{ bundlePermissionOwnerLabel(permission) }}
            </span>
          </li>
        </ul>
      </article>
    </section>
  </section>
</template>
