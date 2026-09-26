<script setup lang="ts">
import type { InferRequestType } from 'hono/client'
import type {
  OrganizationOwnerQueryAccess,
  OrganizationPermissionBundles,
  OrganizationRules,
} from '../../queries/organization'
import { organizationRuleConditionsQuery, organizationRulesQuery } from '../../queries/organization'
import { refreshPrivateAuthorization } from '../../queries/query-cache'
import { reportPrivateQueryAuthorizationDenial } from '../../query-persistence/runtime'
import type { ApiClient } from '../../utils/api-client'
import { toApiQueryError } from '../../utils/query-error'

interface Props {
  access: OrganizationOwnerQueryAccess
  bundles: OrganizationPermissionBundles['bundles']
  invalidationRevision: number
  organizationVersion: number
}

const props = defineProps<Props>()
type CreateRule = InferRequestType<ApiClient['api']['organization']['group-rules']['$post']>['json']
type RuleCondition = CreateRule['condition']
type ListedRule = OrganizationRules['rules'][number]
type RuleKind = RuleCondition['kind']

interface RuleDraft {
  groupId: string | null
  expectedRevision: number | null
  name: string
  bundleIds: string[]
  kind: RuleKind
  predicate: string
  enabled: boolean
  reason: string
  targetUserId: string
}

const apiClient = createApiClient(useRuntimeConfig().public.apiBase)
const queryCache = useQueryCache()
const announcer = useAnnouncer()
const canManage = computed(
  () =>
    props.access.authenticated &&
    props.access.isOrganizationOwner &&
    props.access.memberAccess &&
    !props.access.blocked,
)
const rulesQuery = useQuery(() =>
  organizationRulesQuery({
    access: props.access,
    apiClient,
    organizationVersion: props.organizationVersion,
  }),
)
const conditionsQuery = useQuery(() =>
  organizationRuleConditionsQuery({
    access: props.access,
    apiClient,
    organizationVersion: props.organizationVersion,
  }),
)

const draft = ref<RuleDraft | null>(null)
const preview = shallowRef<Awaited<ReturnType<typeof previewRule>>>()
const previewPages = shallowRef<NonNullable<typeof preview.value>['permissions']>([])
const memberSummary = shallowRef<Awaited<ReturnType<typeof loadMemberSummary>>>()
const pendingDisable = shallowRef<ListedRule>()
const disableReason = ref('')
const busy = ref(false)
const actionError = shallowRef<unknown>()
const statusMessage = ref('')
let operationRevision = 0
let previewRevision = 0

const rules = computed(() => (canManage.value ? (rulesQuery.data.value?.rules ?? []) : []))
const conditionOptions = computed(() => conditionsQuery.data.value?.conditions ?? [])
const roleOptions = computed(() => conditionsQuery.data.value?.corporationRoles ?? [])
const errorMessage = computed(() => {
  const error = actionError.value ?? rulesQuery.error.value ?? conditionsQuery.error.value
  return error instanceof Error ? error.message : ''
})
const previewInputKey = computed(() => {
  const current = draft.value
  if (!current) return null
  const bundleIds = current.bundleIds.toSorted((left, right) => left.localeCompare(right))
  return JSON.stringify([current.kind, current.predicate, current.targetUserId, bundleIds])
})

watch(
  previewInputKey,
  () => {
    previewRevision += 1
    preview.value = undefined
    previewPages.value = []
    memberSummary.value = undefined
  },
  { flush: 'sync' },
)

const resetRuleState = () => {
  operationRevision += 1
  draft.value = null
  preview.value = undefined
  previewPages.value = []
  memberSummary.value = undefined
  pendingDisable.value = undefined
  disableReason.value = ''
  actionError.value = undefined
  statusMessage.value = ''
}

watch(() => props.invalidationRevision, resetRuleState, { flush: 'sync' })
watch(() => props.organizationVersion, resetRuleState, { flush: 'sync' })
watch(
  canManage,
  (allowed) => {
    if (!allowed) resetRuleState()
  },
  { flush: 'sync' },
)
onUnmounted(() => {
  operationRevision += 1
})

const startCreate = () => {
  draft.value = {
    groupId: null,
    expectedRevision: null,
    name: '',
    bundleIds: [],
    kind: 'registration-compliant',
    predicate: '',
    enabled: false,
    reason: '',
    targetUserId: '',
  }
  preview.value = undefined
  previewPages.value = []
  memberSummary.value = undefined
  actionError.value = undefined
}

const startEdit = (rule: ListedRule) => {
  draft.value = {
    groupId: rule.groupId,
    expectedRevision: rule.revision,
    name: rule.name,
    bundleIds: [...rule.bundleIds],
    kind: rule.conditionKind,
    predicate: rule.predicateKey ?? '',
    enabled: rule.enabled,
    reason: '',
    targetUserId: '',
  }
  preview.value = undefined
  previewPages.value = []
  memberSummary.value = undefined
  actionError.value = undefined
}

const selectedCondition = (current: RuleDraft): RuleCondition | null => {
  if (current.kind === 'registration-compliant' || current.kind === 'director-audience') {
    return { kind: current.kind }
  }
  const selected = roleOptions.value.find((role) => role.predicate === current.predicate)
  return selected ? { kind: 'corporation-role', predicate: selected.predicate } : null
}

const previewRule = async (current: RuleDraft, permissionOffset = 0) => {
  const condition = selectedCondition(current)
  if (!condition || !current.targetUserId || current.bundleIds.length === 0) {
    throw new Error('Select a condition and bundle, then enter an in-scope account ID to preview.')
  }
  const response = await apiClient.api.organization['group-rules'].preview.$post({
    json: {
      bundleIds: current.bundleIds,
      condition,
      targetUserId: current.targetUserId,
      permissionOffset,
    },
  })
  if (response.status !== 200) {
    throw await toApiQueryError(response, 'Automatic-group preview is unavailable.')
  }
  return response.json()
}

const showPreview = async (permissionOffset = 0) => {
  const current = draft.value
  if (!current || busy.value) return
  const revision = operationRevision
  const inputRevision = previewRevision
  busy.value = true
  actionError.value = undefined
  try {
    const result = await previewRule(current, permissionOffset)
    if (revision !== operationRevision || inputRevision !== previewRevision || !canManage.value)
      return
    preview.value = result
    previewPages.value =
      permissionOffset === 0 ? result.permissions : [...previewPages.value, ...result.permissions]
    announcer.polite(
      `Rule preview ${result.outcome}. ${result.permissionCount} configured permissions.`,
    )
  } catch (error) {
    if (revision !== operationRevision || inputRevision !== previewRevision) return
    reportPrivateQueryAuthorizationDenial(queryCache, { kind: 'organization' }, error)
    actionError.value = error
    announcer.assertive('Automatic-group preview failed.')
  } finally {
    busy.value = false
  }
}

const persistRule = async (current: RuleDraft, condition: RuleCondition) => {
  if (current.groupId && current.expectedRevision) {
    const response = await apiClient.api.organization['group-rules'][':groupId'].$put({
      param: { groupId: current.groupId },
      json: {
        bundleIds: current.bundleIds,
        condition,
        enabled: current.enabled,
        expectedRevision: current.expectedRevision,
        reason: current.reason.trim(),
      },
    })
    if (response.status !== 200) throw await toApiQueryError(response, 'Rule could not be updated.')
    return
  }
  const response = await apiClient.api.organization['group-rules'].$post({
    json: {
      name: current.name.trim(),
      bundleIds: current.bundleIds,
      condition,
      enabled: current.enabled,
      reason: current.reason.trim(),
    },
  })
  if (response.status !== 201) throw await toApiQueryError(response, 'Rule could not be created.')
}

const saveRule = async () => {
  const current = draft.value
  if (!current || busy.value) return
  const condition = selectedCondition(current)
  if (
    !condition ||
    !current.name.trim() ||
    !current.reason.trim() ||
    current.bundleIds.length === 0
  ) {
    actionError.value = new Error('Name, reason, condition, and at least one bundle are required.')
    return
  }
  const revision = operationRevision
  busy.value = true
  actionError.value = undefined
  try {
    await persistRule(current, condition)
    if (revision !== operationRevision || !canManage.value) return
    draft.value = null
    preview.value = undefined
    await refreshPrivateAuthorization(queryCache, { kind: 'organization' })
    await rulesQuery.refresh()
    statusMessage.value = 'Automatic group saved. Membership is reconciling from current evidence.'
    announcer.polite(statusMessage.value)
  } catch (error) {
    if (revision !== operationRevision) return
    reportPrivateQueryAuthorizationDenial(queryCache, { kind: 'organization' }, error)
    actionError.value = error
    announcer.assertive('Automatic group could not be saved.')
  } finally {
    busy.value = false
  }
}

const disableRule = async (rule: ListedRule) => {
  if (busy.value) return
  const reason = disableReason.value.trim()
  if (!reason) {
    actionError.value = new Error('Give a reason before disabling this rule.')
    return
  }
  const revision = operationRevision
  busy.value = true
  actionError.value = undefined
  try {
    const response = await apiClient.api.organization['group-rules'][':groupId'].disable.$post({
      param: { groupId: rule.groupId },
      json: { expectedRevision: rule.revision, reason },
    })
    if (response.status !== 200)
      throw await toApiQueryError(response, 'Rule could not be disabled.')
    if (revision !== operationRevision || !canManage.value) return
    await refreshPrivateAuthorization(queryCache, { kind: 'organization' })
    await rulesQuery.refresh()
    pendingDisable.value = undefined
    disableReason.value = ''
    statusMessage.value = 'Automatic group disabled. Previous assignments no longer grant access.'
    announcer.polite(statusMessage.value)
  } catch (error) {
    if (revision !== operationRevision) return
    reportPrivateQueryAuthorizationDenial(queryCache, { kind: 'organization' }, error)
    actionError.value = error
  } finally {
    busy.value = false
  }
}

const loadMemberSummary = async (groupId: string, userId: string) => {
  const response = await apiClient.api.organization['group-rules'][':groupId'].members[
    ':userId'
  ].$get({
    param: { groupId, userId },
    query: {},
  })
  if (response.status !== 200)
    throw await toApiQueryError(response, 'Member rule evidence is unavailable.')
  return response.json()
}

const showMemberSummary = async (rule: ListedRule) => {
  const userId = draft.value?.targetUserId
  if (!userId || busy.value) {
    actionError.value = new Error('Enter an in-scope account ID in the rule draft first.')
    return
  }
  const revision = operationRevision
  const inputRevision = previewRevision
  busy.value = true
  try {
    const result = await loadMemberSummary(rule.groupId, userId)
    if (revision !== operationRevision || inputRevision !== previewRevision || !canManage.value)
      return
    memberSummary.value = result
    announcer.polite('Current membership evidence loaded.')
  } catch (error) {
    if (revision !== operationRevision || inputRevision !== previewRevision) return
    reportPrivateQueryAuthorizationDenial(queryCache, { kind: 'organization' }, error)
    actionError.value = error
  } finally {
    busy.value = false
  }
}
</script>

<template>
  <section class="organization-rules" aria-labelledby="organization-rules-heading">
    <header class="organization-access__panel-heading">
      <div>
        <span class="authority-step">AUTOMATIC ACCESS</span>
        <h3 id="organization-rules-heading">Rule-managed groups</h3>
      </div>
      <button
        class="ui-action-primary"
        type="button"
        :disabled="busy || Boolean(draft)"
        @click="startCreate"
      >
        NEW RULE
      </button>
    </header>
    <p>
      Only current, independently verified conditions grant membership. These groups cannot be
      edited by hand.
    </p>
    <output class="sr-only" aria-live="polite">{{ statusMessage }}</output>
    <p v-if="errorMessage" class="ui-inline-error" role="alert">{{ errorMessage }}</p>
    <p v-if="rulesQuery.asyncStatus.value === 'loading'">Loading automatic groups...</p>
    <p v-else-if="rules.length === 0">No automatic groups configured.</p>
    <ul v-else class="organization-rules__list">
      <li v-for="rule in rules" :key="rule.groupId" class="organization-rules__item">
        <div>
          <strong>{{ rule.name }}</strong>
          <p>
            {{ rule.conditionKind }}<span v-if="rule.predicateKey"> / {{ rule.predicateKey }}</span>
          </p>
          <p>
            Revision {{ rule.revision }} · {{ rule.enabled ? 'Enabled' : 'Disabled' }} ·
            {{ rule.completedAt ? 'Reconciled' : 'Reconciliation pending' }}
          </p>
          <p>Membership is automatically managed · Read-only</p>
        </div>
        <div class="organization-rules__actions">
          <button
            class="ui-action-secondary"
            type="button"
            :disabled="busy"
            @click="startEdit(rule)"
          >
            EDIT
          </button>
          <button
            class="ui-action-secondary"
            type="button"
            :disabled="busy || !rule.enabled"
            @click="pendingDisable = rule"
          >
            DISABLE
          </button>
          <button
            class="ui-action-secondary"
            type="button"
            :disabled="busy || !draft?.targetUserId"
            @click="showMemberSummary(rule)"
          >
            VIEW MEMBER EVIDENCE
          </button>
        </div>
      </li>
    </ul>

    <form
      v-if="pendingDisable"
      class="organization-rules__draft"
      @submit.prevent="disableRule(pendingDisable)"
    >
      <h4>Disable {{ pendingDisable.name }}</h4>
      <p>Current rule-backed permissions stop immediately; membership reconciliation follows.</p>
      <label
        >Reason for disabling
        <textarea v-model="disableReason" maxlength="2000" required />
      </label>
      <div class="organization-rules__actions">
        <button class="ui-action-primary" type="submit" :disabled="busy">CONFIRM DISABLE</button>
        <button
          class="ui-action-secondary"
          type="button"
          :disabled="busy"
          @click="pendingDisable = undefined"
        >
          KEEP ENABLED
        </button>
      </div>
    </form>

    <form v-if="draft" class="organization-rules__draft" @submit.prevent="saveRule">
      <h4>{{ draft.groupId ? 'Revise automatic rule' : 'Create automatic rule' }}</h4>
      <label
        >Group name
        <input
          v-model="draft.name"
          type="text"
          maxlength="100"
          required
          :disabled="Boolean(draft.groupId)"
        />
      </label>
      <label
        >Condition
        <select v-model="draft.kind">
          <option v-for="kind in conditionOptions" :key="kind" :value="kind">{{ kind }}</option>
        </select>
      </label>
      <label v-if="draft.kind === 'corporation-role'"
        >Reviewed global EVE role
        <select v-model="draft.predicate" required>
          <option value="" disabled>Select a role</option>
          <option v-for="role in roleOptions" :key="role.predicate" :value="role.predicate">
            {{ role.predicate }}
          </option>
        </select>
      </label>
      <fieldset>
        <legend>Permission bundles</legend>
        <label v-for="bundle in bundles" :key="bundle.bundleId">
          <input v-model="draft.bundleIds" type="checkbox" :value="bundle.bundleId" />
          {{ bundle.name }} ({{ bundle.permissions.length }} entries)
        </label>
      </fieldset>
      <label
        >Reason
        <textarea v-model="draft.reason" maxlength="2000" required />
      </label>
      <label class="organization-rules__enabled">
        <input v-model="draft.enabled" type="checkbox" /> Enable after saving
      </label>
      <label
        >Account ID to preview
        <input
          v-model="draft.targetUserId"
          type="text"
          autocomplete="off"
          placeholder="Current in-scope account UUID"
        />
      </label>
      <div class="organization-rules__actions">
        <button class="ui-action-secondary" type="button" :disabled="busy" @click="showPreview()">
          PREVIEW ELIGIBILITY
        </button>
        <button class="ui-action-primary" type="submit" :disabled="busy">
          {{ busy ? 'WORKING...' : 'SAVE RULE' }}
        </button>
        <button class="ui-action-secondary" type="button" :disabled="busy" @click="draft = null">
          CANCEL
        </button>
      </div>
    </form>

    <section v-if="preview" class="organization-rules__preview" aria-label="Rule preview">
      <h4>Prospective access: {{ preview.outcome }}</h4>
      <p>Evidence: {{ preview.evidenceStatus }} · {{ preview.reason }}</p>
      <p>
        {{ preview.sourceCount }} qualifying source(s) · {{ preview.permissionCount }} configured
        permission(s).
      </p>
      <p v-if="preview.sourcesTruncated">More sources qualify than shown here.</p>
      <ul>
        <li v-for="source in preview.sources" :key="`${source.kind}:${source.sourceId}`">
          {{ source.kind }} · valid until {{ source.validUntil ?? 'unavailable' }}
        </li>
      </ul>
      <ul>
        <li
          v-for="permission in previewPages"
          :key="`${permission.type}:${permission.publisherPackage}:${permission.moduleId}:${permission.key}`"
        >
          {{ permission.type }} · {{ permission.key }}
        </li>
      </ul>
      <button
        v-if="preview.nextPermissionOffset !== null"
        class="ui-action-secondary"
        type="button"
        :disabled="busy"
        @click="showPreview(preview.nextPermissionOffset)"
      >
        MORE PERMISSIONS
      </button>
      <p>
        Preview grants no access. Only the saved rule and current evidence may grant membership.
      </p>
    </section>
    <section
      v-if="memberSummary"
      class="organization-rules__preview"
      aria-label="Current member evidence"
    >
      <h4>Current membership · Read-only</h4>
      <p>
        {{
          memberSummary.assignment?.currentRule
            ? 'Current rule assignment'
            : 'No current rule assignment'
        }}
      </p>
      <ul>
        <li
          v-for="source in memberSummary.sourceMetadata"
          :key="`${source.sourceKind}:${source.sourceId}`"
        >
          {{ source.sourceKind }} · valid until {{ source.validUntil }}
        </li>
      </ul>
      <p v-if="memberSummary.sourcesTruncated">Additional sources are not shown.</p>
      <p>{{ memberSummary.permissionCount }} current effective permission(s).</p>
    </section>
  </section>
</template>

<style scoped>
.organization-rules {
  display: grid;
  gap: 1rem;
  min-width: 0;
  overflow-wrap: anywhere;
}
.organization-rules__list {
  display: grid;
  gap: 0.75rem;
  list-style: none;
  padding: 0;
}
.organization-rules__item {
  display: flex;
  flex-wrap: wrap;
  justify-content: space-between;
  gap: 1rem;
}
.organization-rules__actions {
  display: flex;
  flex-wrap: wrap;
  gap: 0.5rem;
  align-items: center;
}
.organization-rules__draft,
.organization-rules__preview {
  display: grid;
  gap: 0.75rem;
}
.organization-rules__draft fieldset {
  display: grid;
  gap: 0.5rem;
}
.organization-rules__enabled {
  display: flex;
  gap: 0.5rem;
  align-items: center;
}
</style>
