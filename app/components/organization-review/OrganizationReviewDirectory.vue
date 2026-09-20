<script setup lang="ts">
import {
  platformReviewerDirectoryAuditStates,
  platformReviewerDirectoryComplianceStates,
  platformReviewerDirectoryDefaultSortDirection,
  platformReviewerDirectoryDefaultSortField,
  type PlatformReviewerDirectoryAuditState,
  type PlatformReviewerDirectoryComplianceState,
  type PlatformReviewerDirectorySortDirection,
  type PlatformReviewerDirectorySortField,
} from '@eve-space/platform-module-contract/reviewer-directory'
import { useOrganizationReviewDirectoryColumnPreferences } from '../../composables/useOrganizationReviewDirectoryColumnPreferences'
import {
  type OrganizationReviewDirectoryGroupFacet,
  type OrganizationReviewDirectoryMember,
} from '../../queries/organization-review'
import {
  organizationReviewDirectoryFields,
  type OrganizationReviewDirectoryFieldDefinition,
  type OrganizationReviewDirectoryFieldId,
} from '../../utils/organization-review-directory-fields'

const props = withDefaults(
  defineProps<{
    auditState?: PlatformReviewerDirectoryAuditState
    blocked?: boolean
    complianceState?: PlatformReviewerDirectoryComplianceState
    corporationText: string
    direction?: PlatformReviewerDirectorySortDirection
    groupFacets: readonly OrganizationReviewDirectoryGroupFacet[]
    groupId?: string
    hasNextPage: boolean
    hasPreviousPage: boolean
    limit: number
    loading: boolean
    members: readonly OrganizationReviewDirectoryMember[]
    page?: number
    searchText: string
    selectedUserId?: string
    sort?: PlatformReviewerDirectorySortField
  }>(),
  {
    auditState: undefined,
    blocked: undefined,
    complianceState: undefined,
    direction: platformReviewerDirectoryDefaultSortDirection,
    groupId: undefined,
    page: 1,
    selectedUserId: undefined,
    sort: platformReviewerDirectoryDefaultSortField,
  },
)

const emit = defineEmits<{
  next: []
  previous: []
  search: []
  select: [member: OrganizationReviewDirectoryMember]
  'change-sort': [
    value: {
      readonly sort: PlatformReviewerDirectorySortField
      readonly direction: PlatformReviewerDirectorySortDirection
    },
  ]
  'update:auditState': [value: PlatformReviewerDirectoryAuditState | undefined]
  'update:blocked': [value: boolean | undefined]
  'update:complianceState': [value: PlatformReviewerDirectoryComplianceState | undefined]
  'update:corporationText': [value: string]
  'update:groupId': [value: string | undefined]
  'update:limit': [value: number]
  'update:searchText': [value: string]
}>()

const allFilterValue = 'all'
const preferences = useOrganizationReviewDirectoryColumnPreferences()
const visibleFields = computed(() =>
  preferences.visibleFieldIds.value.map((fieldId) => directoryField(fieldId)),
)
const renderedRows = computed(() =>
  props.members.map((member) => ({
    member,
    cells: visibleFields.value.map((field) => ({ field, presentation: field.present(member) })),
  })),
)
const resultAnnouncement = computed(() => {
  if (props.loading) return 'Loading managed members.'
  const count = props.members.length
  return `Page ${props.page}, ${count} managed ${count === 1 ? 'member' : 'members'}.`
})
const auditFilter = computed<string>({
  get: () => props.auditState ?? allFilterValue,
  set: (value) =>
    emit(
      'update:auditState',
      value === allFilterValue ? undefined : (value as PlatformReviewerDirectoryAuditState),
    ),
})
const complianceFilter = computed<string>({
  get: () => props.complianceState ?? allFilterValue,
  set: (value) =>
    emit(
      'update:complianceState',
      value === allFilterValue ? undefined : (value as PlatformReviewerDirectoryComplianceState),
    ),
})
const blockFilter = computed<string>({
  get: () => {
    if (props.blocked === undefined) return allFilterValue
    return props.blocked ? 'blocked' : 'clear'
  },
  set: (value) =>
    emit('update:blocked', value === allFilterValue ? undefined : value === 'blocked'),
})
const sortModel = computed<string>({
  get: () => props.sort,
  set: (value) => requestSort(value as PlatformReviewerDirectorySortField, props.direction),
})
const directionModel = computed<string>({
  get: () => props.direction,
  set: (value) => requestSort(props.sort, value as PlatformReviewerDirectorySortDirection),
})
const limitModel = computed<string>({
  get: () => String(props.limit),
  set: (value) => emit('update:limit', Number(value)),
})
const groupChoices = computed(() => {
  return props.groupFacets.map(({ groupId, name }) => ({ groupId, label: name }))
})
const groupFilterOptions = computed(() => {
  const labels = groupChoices.value.map(({ label }) => label)
  if (!props.groupId || groupChoices.value.some(({ groupId }) => groupId === props.groupId))
    return labels
  return [...labels, `Group ${props.groupId}`]
})
const groupFilterText = ref('')
const groupFilterModel = computed<string>({
  get: () => groupFilterText.value,
  set: updateGroupFilter,
})

watch([() => props.groupId, groupChoices], syncGroupFilterText, { immediate: true })

const auditOptions = [
  { value: allFilterValue, label: 'All audit states' },
  ...platformReviewerDirectoryAuditStates.map((state) => ({
    value: state,
    label: organizationReviewDirectoryAuditStateLabel(state),
  })),
]
const complianceOptions = [
  { value: allFilterValue, label: 'All compliance states' },
  ...platformReviewerDirectoryComplianceStates.map((state) => ({
    value: state,
    label: organizationReviewDirectoryAccess(state, { blocked: false }).label,
  })),
]
const blockOptions = [
  { value: allFilterValue, label: 'Any block state' },
  { value: 'clear', label: 'Not blocked' },
  { value: 'blocked', label: 'Blocked' },
]
const sortOptions = organizationReviewDirectoryFields.flatMap((field) =>
  field.sort ? [{ value: field.sort, label: field.label }] : [],
)
const directionOptions = [
  { value: 'asc', label: 'Ascending' },
  { value: 'desc', label: 'Descending' },
]
const limitOptions = [
  { value: '10', label: '10 rows' },
  { value: '25', label: '25 rows' },
  { value: '50', label: '50 rows' },
]

function directoryField(fieldId: OrganizationReviewDirectoryFieldId) {
  return organizationReviewDirectoryFields.find(({ id }) => id === fieldId)!
}

function fieldClass(fieldId: OrganizationReviewDirectoryFieldId) {
  return `organization-review-directory__cell--${fieldId.replaceAll('_', '-')}`
}

function selected(member: OrganizationReviewDirectoryMember) {
  return member.account.userId === props.selectedUserId
}

function requestHeaderSort(field: OrganizationReviewDirectoryFieldDefinition) {
  if (!field.sort) return
  const direction =
    props.sort === field.sort && props.direction === 'asc' ? ('desc' as const) : ('asc' as const)
  requestSort(field.sort, direction)
}

function requestSort(
  sort: PlatformReviewerDirectorySortField,
  direction: PlatformReviewerDirectorySortDirection,
) {
  emit('change-sort', { sort, direction })
}

function ariaSort(field: OrganizationReviewDirectoryFieldDefinition) {
  if (!field.sort || field.sort !== props.sort) return 'none'
  return props.direction === 'asc' ? 'ascending' : 'descending'
}

function sortLabel(field: OrganizationReviewDirectoryFieldDefinition) {
  if (field.sort !== props.sort) return `Sort by ${field.label}`
  return `Sort by ${field.label}, currently ${props.direction === 'asc' ? 'ascending' : 'descending'}`
}

function sortIndicator(field: OrganizationReviewDirectoryFieldDefinition) {
  if (field.sort !== props.sort) return '↕'
  return props.direction === 'asc' ? '↑' : '↓'
}

function syncGroupFilterText() {
  if (!props.groupId) {
    groupFilterText.value = ''
    return
  }
  groupFilterText.value =
    groupChoices.value.find(({ groupId }) => groupId === props.groupId)?.label ??
    `Group ${props.groupId}`
}

function updateGroupFilter(value: string) {
  groupFilterText.value = value
  if (value === '') {
    emit('update:groupId', undefined)
    return
  }
  const groupId = groupChoices.value.find(({ label }) => label === value)?.groupId
  if (groupId) emit('update:groupId', groupId)
}

function updateColumnVisibility(field: OrganizationReviewDirectoryFieldDefinition, event: Event) {
  if (field.locked) return
  if ((event.target as HTMLInputElement).checked) preferences.showField(field.id)
  else preferences.hideField(field.id)
}

function fieldVisible(fieldId: OrganizationReviewDirectoryFieldId) {
  return preferences.visibleFieldIds.value.includes(fieldId)
}

function canMove(fieldId: OrganizationReviewDirectoryFieldId, direction: 'up' | 'down') {
  const index = preferences.visibleFieldIds.value.indexOf(fieldId)
  if (index < 1) return false
  return direction === 'up' ? index > 1 : index < preferences.visibleFieldIds.value.length - 2
}
</script>

<template>
  <section class="organization-review-directory" aria-labelledby="review-directory-heading">
    <header class="organization-review-directory__heading">
      <div>
        <p class="ui-eyebrow">MANAGED DIRECTORY</p>
        <h2 id="review-directory-heading">Select a member</h2>
      </div>
      <UiPopover align="end" close-label="Close column settings">
        <template #trigger>
          <button class="ui-action-secondary" type="button">
            COLUMNS {{ preferences.visibleFieldIds.value.length }}
          </button>
        </template>
        <section
          class="organization-review-directory__columns"
          aria-labelledby="directory-columns-title"
        >
          <div>
            <strong id="directory-columns-title">Visible columns</strong>
            <span>
              {{ preferences.visibleFieldIds.value.length }} of
              {{ organizationReviewDirectoryFields.length }}
            </span>
          </div>
          <ol>
            <li v-for="field in organizationReviewDirectoryFields" :key="field.id">
              <label :for="`review-directory-column-${field.id}`">
                <input
                  :id="`review-directory-column-${field.id}`"
                  type="checkbox"
                  :checked="fieldVisible(field.id)"
                  :disabled="Boolean(field.locked)"
                  @change="updateColumnVisibility(field, $event)"
                />
                <span>{{ field.label }}</span>
                <small v-if="field.locked">Locked</small>
              </label>
              <span
                v-if="!field.locked && fieldVisible(field.id)"
                class="organization-review-directory__column-order"
              >
                <button
                  type="button"
                  :aria-label="`Move ${field.label} earlier`"
                  :disabled="!canMove(field.id, 'up')"
                  @click="preferences.moveField(field.id, 'up')"
                >
                  ↑
                </button>
                <button
                  type="button"
                  :aria-label="`Move ${field.label} later`"
                  :disabled="!canMove(field.id, 'down')"
                  @click="preferences.moveField(field.id, 'down')"
                >
                  ↓
                </button>
              </span>
            </li>
          </ol>
          <button class="ui-action-secondary" type="button" @click="preferences.resetFields">
            RESET TO DEFAULT
          </button>
        </section>
      </UiPopover>
    </header>

    <form
      class="organization-review-directory__filters"
      role="search"
      aria-label="Managed member directory filters"
      @submit.prevent="emit('search')"
    >
      <label
        class="organization-review-directory__filter organization-review-directory__filter--search"
      >
        <span>Member search</span>
        <input
          class="ui-input"
          :value="props.searchText"
          type="search"
          maxlength="80"
          autocomplete="off"
          placeholder="Character or account"
          @input="emit('update:searchText', ($event.target as HTMLInputElement).value)"
        />
      </label>
      <label class="organization-review-directory__filter">
        <span>Corporation ID</span>
        <input
          class="ui-input"
          :value="props.corporationText"
          type="number"
          min="1"
          step="1"
          inputmode="numeric"
          placeholder="All corporations"
          @input="emit('update:corporationText', ($event.target as HTMLInputElement).value)"
        />
      </label>
      <div class="organization-review-directory__filter">
        <span>Group</span>
        <UiAutocomplete
          v-model="groupFilterModel"
          input-id="organization-review-group-filter"
          label="Group filter"
          :options="groupFilterOptions"
          placeholder="All groups"
        />
      </div>
      <div class="organization-review-directory__filter">
        <span>Compliance</span>
        <UiSelect
          v-model="complianceFilter"
          label="Compliance filter"
          :options="complianceOptions"
        />
      </div>
      <div class="organization-review-directory__filter">
        <span>Block state</span>
        <UiSelect v-model="blockFilter" label="Block state filter" :options="blockOptions" />
      </div>
      <div class="organization-review-directory__filter">
        <span>Audit data</span>
        <UiSelect v-model="auditFilter" label="Audit data filter" :options="auditOptions" />
      </div>
      <div class="organization-review-directory__filter">
        <span>Sort by</span>
        <UiSelect v-model="sortModel" label="Sort directory by" :options="sortOptions" />
      </div>
      <div class="organization-review-directory__filter">
        <span>Direction</span>
        <UiSelect v-model="directionModel" label="Sort direction" :options="directionOptions" />
      </div>
      <div class="organization-review-directory__filter">
        <span>Page size</span>
        <UiSelect v-model="limitModel" label="Results per page" :options="limitOptions" />
      </div>
      <button
        class="ui-action-primary organization-review-directory__search"
        type="submit"
        :disabled="props.loading"
      >
        SEARCH
      </button>
    </form>

    <output class="sr-only" aria-live="polite">{{ resultAnnouncement }}</output>
    <output
      v-if="props.loading && props.members.length === 0"
      class="organization-review-directory__status"
    >
      Searching managed members...
    </output>
    <output v-else-if="props.members.length === 0" class="organization-review-directory__status">
      No managed members match these filters.
    </output>
    <div v-else class="organization-review-directory__table-frame">
      <UiScrollArea horizontal class="organization-review-directory__scroll">
        <table :aria-busy="props.loading">
          <caption>
            Current managed organization accounts and their bounded review summaries
          </caption>
          <thead>
            <tr>
              <th
                v-for="field in visibleFields"
                :key="field.id"
                scope="col"
                :class="fieldClass(field.id)"
                :aria-sort="field.sort ? ariaSort(field) : undefined"
              >
                <button
                  v-if="field.sort"
                  class="organization-review-directory__sort"
                  type="button"
                  :aria-label="sortLabel(field)"
                  @click="requestHeaderSort(field)"
                >
                  <span>{{ field.label }}</span>
                  <span aria-hidden="true">{{ sortIndicator(field) }}</span>
                </button>
                <span v-else>{{ field.label }}</span>
              </th>
            </tr>
          </thead>
          <tbody>
            <tr
              v-for="row in renderedRows"
              :key="row.member.managedMemberLifecycleId"
              :class="{ 'is-selected': selected(row.member) }"
            >
              <td v-for="cell in row.cells" :key="cell.field.id" :class="fieldClass(cell.field.id)">
                <button
                  v-if="cell.presentation.kind === 'member'"
                  class="organization-review-directory__member"
                  type="button"
                  :aria-pressed="selected(row.member)"
                  :aria-label="`${selected(row.member) ? 'Selected member' : 'Select'} ${cell.presentation.identity.name}`"
                  @click="emit('select', row.member)"
                >
                  <UiEveImage
                    kind="character"
                    :id="cell.presentation.identity.characterId"
                    :dimension="32"
                    :width="32"
                    :height="32"
                    loading="lazy"
                    decoding="async"
                    alt=""
                  />
                  <span>
                    <strong>{{ cell.presentation.identity.name }}</strong>
                    <small>{{ cell.presentation.detail }}</small>
                    <small
                      v-if="selected(row.member)"
                      class="organization-review-directory__selected"
                    >
                      Selected member
                    </small>
                  </span>
                </button>
                <span v-else-if="cell.presentation.kind === 'text'">
                  {{ cell.presentation.value }}
                </span>
                <OrganizationReviewDirectoryDate
                  v-else-if="cell.presentation.kind === 'date'"
                  :timestamp="cell.presentation.timestamp"
                />
                <div
                  v-else-if="cell.presentation.kind === 'audit'"
                  class="organization-review-directory__summary"
                >
                  <strong :data-state="cell.presentation.state">
                    {{ cell.presentation.label }}
                  </strong>
                  <small>
                    {{ cell.presentation.covered }} of {{ cell.presentation.expected }} covered
                  </small>
                  <OrganizationReviewDirectoryDate
                    v-if="cell.presentation.asOf"
                    :timestamp="cell.presentation.asOf"
                  />
                </div>
                <OrganizationReviewDirectoryGroups
                  v-else-if="cell.presentation.kind === 'groups'"
                  :groups="cell.presentation.groups"
                />
                <div
                  v-else-if="cell.presentation.kind === 'access'"
                  class="organization-review-directory__summary"
                >
                  <strong :data-state="cell.presentation.state">
                    {{ cell.presentation.label }}
                  </strong>
                  <small>Evidence {{ cell.presentation.evidenceFreshness }}</small>
                </div>
                <button
                  v-else
                  class="ui-action-secondary organization-review-directory__review"
                  type="button"
                  :aria-pressed="selected(row.member)"
                  @click="emit('select', row.member)"
                >
                  {{ selected(row.member) ? 'SELECTED' : 'REVIEW' }}
                </button>
              </td>
            </tr>
          </tbody>
        </table>
      </UiScrollArea>
    </div>

    <UiContinuationPagination
      class="organization-review-directory__pagination"
      button-class="ui-action-secondary"
      :current-page="props.page"
      :disabled="props.loading"
      :has-next="props.hasNextPage"
      :has-previous="props.hasPreviousPage"
      label="Managed member directory pages"
      next-label="Next member page"
      previous-label="Previous member page"
      @next="emit('next')"
      @previous="emit('previous')"
    />
  </section>
</template>

<style scoped>
.organization-review-directory {
  display: grid;
  width: 100%;
  min-width: 0;
  max-width: 100%;
  gap: 1rem;
  box-sizing: border-box;
  padding: clamp(1rem, 2vw, 1.5rem);
  border: 1px solid var(--ui-border);
  background: var(--ui-surface-raised);
  overflow-x: clip;
}

.organization-review-directory__heading {
  display: flex;
  min-width: 0;
  gap: 1rem;
  align-items: end;
  justify-content: space-between;
}

.organization-review-directory h2 {
  margin: 0.25rem 0 0;
}

.organization-review-directory__columns {
  width: min(24rem, calc(100vw - 3rem));
  padding: 0.25rem;
}

.organization-review-directory__columns > div {
  display: flex;
  gap: 1rem;
  align-items: baseline;
  justify-content: space-between;
}

.organization-review-directory__columns > div > span,
.organization-review-directory__columns small {
  color: var(--ui-text-muted);
  font-size: 0.72rem;
}

.organization-review-directory__columns ol {
  display: grid;
  gap: 0.25rem;
  padding: 0;
  margin: 0.8rem 0;
  list-style: none;
}

.organization-review-directory__columns li,
.organization-review-directory__columns label,
.organization-review-directory__column-order {
  display: flex;
  min-width: 0;
  gap: 0.5rem;
  align-items: center;
}

.organization-review-directory__columns li {
  min-height: 2rem;
  justify-content: space-between;
}

.organization-review-directory__columns label {
  flex: 1;
}

.organization-review-directory__columns label span {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.organization-review-directory__column-order button {
  width: 2rem;
  min-height: 2rem;
  border: 1px solid var(--ui-border);
  background: var(--ui-control);
  color: var(--ui-text);
}

.organization-review-directory__filters {
  display: grid;
  grid-template-columns: repeat(5, minmax(8.5rem, 1fr));
  gap: 0.65rem;
  align-items: end;
  padding: 0.8rem;
  border: 1px solid var(--ui-border);
  background: color-mix(in srgb, var(--ui-surface) 72%, transparent);
}

.organization-review-directory__filter {
  display: grid;
  min-width: 0;
  gap: 0.35rem;
  color: var(--ui-text-muted);
  font-size: 0.72rem;
  letter-spacing: 0.04em;
  text-transform: uppercase;
}

.organization-review-directory__filter--search {
  grid-column: span 2;
}

.organization-review-directory__filter input {
  box-sizing: border-box;
  width: 100%;
  min-width: 0;
  min-height: 2.5rem;
}

.organization-review-directory__search {
  min-height: 2.5rem;
}

.organization-review-directory__table-frame,
.organization-review-directory__scroll {
  width: 100%;
  min-width: 0;
  max-width: 100%;
}

.organization-review-directory__table-frame {
  border: 1px solid var(--ui-border);
  overflow-x: auto;
}

.organization-review-directory table {
  width: 100%;
  min-width: max(52rem, 100%);
  border-collapse: collapse;
  color: var(--ui-text);
  font-size: 0.82rem;
}

.organization-review-directory caption {
  position: absolute;
  width: 1px;
  height: 1px;
  padding: 0;
  margin: -1px;
  overflow: hidden;
  clip: rect(0, 0, 0, 0);
  white-space: nowrap;
  border: 0;
}

.organization-review-directory th,
.organization-review-directory td {
  min-width: 8.5rem;
  padding: 0.65rem 0.75rem;
  border-bottom: 1px solid var(--ui-border);
  background: var(--ui-surface);
  text-align: left;
  vertical-align: middle;
}

.organization-review-directory th {
  position: sticky;
  top: 0;
  z-index: 2;
  background: var(--ui-surface-solid);
  color: var(--ui-text-muted);
  font-size: 0.7rem;
  letter-spacing: 0.07em;
  text-transform: uppercase;
  white-space: nowrap;
}

.organization-review-directory tbody tr:last-child td {
  border-bottom: 0;
}

.organization-review-directory tbody tr:hover td,
.organization-review-directory tbody tr.is-selected td {
  background: color-mix(in srgb, var(--ui-primary) 7%, var(--ui-surface));
}

.organization-review-directory tbody tr.is-selected td {
  box-shadow:
    inset 0 1px color-mix(in srgb, var(--ui-primary) 55%, transparent),
    inset 0 -1px color-mix(in srgb, var(--ui-primary) 55%, transparent);
}

.organization-review-directory__cell--member {
  position: sticky;
  left: 0;
  z-index: 1;
  min-width: 14rem !important;
}

.organization-review-directory th.organization-review-directory__cell--member,
.organization-review-directory th.organization-review-directory__cell--actions {
  z-index: 3;
}

.organization-review-directory__cell--actions {
  position: sticky;
  right: 0;
  z-index: 1;
  min-width: 6.5rem !important;
  text-align: right !important;
}

.organization-review-directory__sort,
.organization-review-directory__member {
  border: 0;
  background: transparent;
  color: inherit;
  cursor: pointer;
}

.organization-review-directory__sort {
  display: inline-flex;
  width: 100%;
  gap: 0.4rem;
  align-items: center;
  justify-content: space-between;
  padding: 0;
  font: inherit;
  letter-spacing: inherit;
  text-transform: inherit;
}

.organization-review-directory__sort[aria-label*='currently'] {
  color: var(--ui-primary);
}

.organization-review-directory__member {
  display: grid;
  width: 100%;
  min-width: 0;
  grid-template-columns: 2rem minmax(0, 1fr);
  gap: 0.6rem;
  align-items: center;
  padding: 0;
  text-align: left;
}

.organization-review-directory__member > span,
.organization-review-directory__summary {
  display: grid;
  min-width: 0;
  gap: 0.2rem;
}

.organization-review-directory__member strong,
.organization-review-directory__member small,
.organization-review-directory__corporation {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.organization-review-directory__member small,
.organization-review-directory__summary small {
  color: var(--ui-text-muted);
  font-size: 0.7rem;
}

.organization-review-directory__selected {
  color: var(--ui-primary) !important;
  font-weight: 600;
  letter-spacing: 0.05em;
  text-transform: uppercase;
}

.organization-review-directory__summary strong {
  color: var(--ui-text);
  font-size: 0.78rem;
  white-space: nowrap;
}

.organization-review-directory__summary strong[data-state='current'],
.organization-review-directory__summary strong[data-state='compliant'] {
  color: var(--ui-success);
}

.organization-review-directory__summary strong[data-state='stale'],
.organization-review-directory__summary strong[data-state='pending'],
.organization-review-directory__summary strong[data-state='review_required'],
.organization-review-directory__summary strong[data-state='authorization-required'] {
  color: var(--ui-warning);
}

.organization-review-directory__summary strong[data-state='blocked'],
.organization-review-directory__summary strong[data-state='suspended'],
.organization-review-directory__summary strong[data-state='unavailable'] {
  color: var(--ui-danger);
}

.organization-review-directory__review {
  min-height: 2rem;
  padding: 0.35rem 0.55rem;
}

.organization-review-directory__status {
  display: block;
  min-height: 5rem;
  padding: 2rem 1rem;
  border: 1px dashed var(--ui-border);
  color: var(--ui-text-muted);
  text-align: center;
}

.organization-review-directory__pagination {
  justify-self: end;
}

.organization-review-directory button:focus-visible,
.organization-review-directory input:focus-visible {
  outline: var(--ui-focus-ring-width) solid var(--ui-focus-ring);
  outline-offset: 2px;
}

@media (max-width: 52rem) {
  .organization-review-directory__filters {
    grid-template-columns: repeat(3, minmax(8rem, 1fr));
  }
}

@media (max-width: 44rem) {
  .organization-review-directory__filters {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }

  .organization-review-directory__filter--search {
    grid-column: span 2;
  }
}

@media (max-width: 36rem) {
  .organization-review-directory {
    padding: 0.75rem;
  }

  .organization-review-directory__heading {
    align-items: start;
  }

  .organization-review-directory__filters {
    grid-template-columns: minmax(0, 1fr);
  }

  .organization-review-directory__filter--search {
    grid-column: auto;
  }
}

@media (prefers-reduced-motion: reduce) {
  .organization-review-directory *,
  .organization-review-directory *::before,
  .organization-review-directory *::after {
    scroll-behavior: auto;
    transition-duration: 0.01ms !important;
  }
}
</style>
