<script setup lang="ts">
import Fuse from 'fuse.js'
import type { CharacterSkillQueue, CharacterSkills } from '../../../queries/characters'
import { queuedLevelsByType, romanLevel } from '../../../utils/skill-queue'
import {
  groupKeyOf,
  indexSkills,
  isInjectedOnly,
  levelCells,
  levelDescription,
  resolveActiveGroupKey,
  resolveInitialGroupKey,
  selectVisibleSkills,
  summariseGroups,
  type GroupSummary,
  type IndexedSkill,
} from '../../../utils/skill-catalogue'

const props = defineProps<{
  skills: CharacterSkills
  skillQueue: CharacterSkillQueue | undefined
  skillQueueStatus: 'idle' | 'loading' | 'scope-required' | 'error'
}>()

const search = ref('')
const searchTerm = computed(() => search.value.trim())
const searchTokens = computed(() => searchTerm.value.toLowerCase().split(/\s+/).filter(Boolean))
const searching = computed(() => searchTokens.value.length > 0)
const levelFilter = ref<'all' | 'untrained' | 'progress' | 'v'>('all')
const levelFilters = [
  { id: 'all', label: 'ALL' },
  { id: 'untrained', label: 'UNTRAINED' },
  { id: 'progress', label: 'IN PROGRESS' },
  { id: 'v', label: 'AT V' },
] as const
const queuedOnly = ref(false)
const revealedSkillNameId = ref<number | null>(null)
const groups = computed(() => props.skills.groups)
const fuseOptions = {
  keys: ['name'],
  threshold: 0.18,
  ignoreLocation: true,
  minMatchCharLength: 2,
}
const indexedSkills = computed(() => indexSkills(groups.value))
const skillIndex = computed(() => new Fuse(indexedSkills.value, fuseOptions))
const groupIndex = computed(
  () =>
    new Fuse(
      groups.value.map((group) => ({ key: groupKeyOf(group.groupId), name: group.name })),
      fuseOptions,
    ),
)

function intersectTokens<Item, Id>(
  index: Fuse<Item>,
  tokens: readonly string[],
  identify: (item: Item) => Id,
): Set<Id> {
  let matched: Set<Id> | null = null
  for (const token of tokens) {
    const hits = new Set<Id>(index.search(token).map((result) => identify(result.item)))
    if (matched === null) {
      matched = hits
    } else {
      const intersection = new Set<Id>()
      for (const id of matched) if (hits.has(id)) intersection.add(id)
      matched = intersection
    }
    if (matched.size === 0) break
  }
  return matched ?? new Set<Id>()
}

const searchMatches = computed(() =>
  searching.value
    ? {
        skillIds: intersectTokens(skillIndex.value, searchTokens.value, (skill) => skill.typeId),
        groupKeys: intersectTokens(groupIndex.value, searchTokens.value, (group) => group.key),
      }
    : null,
)
const queuedLevels = computed(() => queuedLevelsByType(props.skillQueue))
const hasQueuedSkills = computed(() => queuedLevels.value.size > 0)
const queuedFilterDisabled = computed(
  () => !queuedOnly.value && (props.skillQueueStatus !== 'idle' || !hasQueuedSkills.value),
)
const queuedFilterLabel = computed(() => {
  if (queuedOnly.value) return 'Show all catalogue skills'
  if (props.skillQueueStatus === 'loading') return 'Skill queue is loading'
  if (props.skillQueueStatus === 'scope-required') return 'Skill queue authorization required'
  if (props.skillQueueStatus === 'error') return 'Skill queue unavailable'
  return hasQueuedSkills.value ? 'Show queued skills only' : 'No queued skills available'
})
const filteredSkills = computed(() =>
  selectVisibleSkills(indexedSkills.value, levelFilter.value, searchMatches.value),
)
const visibleSkills = computed(() =>
  queuedOnly.value
    ? filteredSkills.value.filter((skill) => queuedLevels.value.has(skill.typeId))
    : filteredSkills.value,
)
const groupSummaries = computed(() => summariseGroups(groups.value, visibleSkills.value))
const selectedGroupKey = ref<string | null>(resolveInitialGroupKey(groups.value))
const activeGroupKey = computed(() =>
  resolveActiveGroupKey(groupSummaries.value, selectedGroupKey.value, searching.value),
)
const activeGroup = computed(() =>
  groupSummaries.value.find((group) => group.key === activeGroupKey.value),
)

function selectGroup(key: string) {
  selectedGroupKey.value = key
  search.value = ''
}

function revealTruncatedSkillName(typeId: number, event: MouseEvent) {
  const name = event.currentTarget as HTMLElement
  revealedSkillNameId.value = name.scrollWidth > name.clientWidth ? typeId : null
}

function hideSkillName(typeId: number) {
  if (revealedSkillNameId.value === typeId) revealedSkillNameId.value = null
}

const rows = computed(() =>
  searching.value
    ? visibleSkills.value
    : visibleSkills.value.filter((skill) => skill.groupKey === activeGroupKey.value),
)
const rowsSp = computed(() => rows.value.reduce((total, skill) => total + skill.skillpoints, 0))
const rowsAtFive = computed(() => rows.value.filter((skill) => skill.trainedLevel === 5).length)
const rowsGroupCount = computed(() => new Set(rows.value.map((skill) => skill.groupKey)).size)
const listTitle = computed(() =>
  searching.value ? `Results for "${searchTerm.value}"` : (activeGroup.value?.name ?? 'Skills'),
)
const listMeta = computed(() =>
  searching.value
    ? `${rows.value.length} CATALOGUE SKILLS ACROSS ${rowsGroupCount.value} GROUPS`
    : `${rows.value.length} CATALOGUE SKILLS / ${rowsAtFive.value} AT V`,
)
const visibleGroupCount = computed(
  () => groupSummaries.value.filter((group) => group.count > 0).length,
)
const resultsRefined = computed(
  () => searching.value || levelFilter.value !== 'all' || queuedOnly.value,
)
const compactResultStatus = computed(() => {
  const resultLabel = searching.value
    ? pluralize(visibleSkills.value.length, 'MATCH', 'MATCHES')
    : pluralize(visibleSkills.value.length, 'SKILL', 'SKILLS')
  const groupWord = visibleGroupCount.value === 1 ? 'GROUP' : 'GROUPS'
  return `${visibleSkills.value.length} ${resultLabel} / ${visibleGroupCount.value} ${groupWord}`
})
const resultAnnouncement = computed(() => {
  const skillLabel = visibleSkills.value.length === 1 ? 'SKILL' : 'SKILLS'
  const groupWord = visibleGroupCount.value === 1 ? 'GROUP' : 'GROUPS'
  return `${visibleSkills.value.length} CATALOGUE ${skillLabel}${searching.value ? ' MATCHED' : ''} ACROSS ${visibleGroupCount.value} ${groupWord}`
})
const announcedResult = ref('')
let announcementTimer: ReturnType<typeof setTimeout> | undefined

watch(
  resultAnnouncement,
  (announcement) => {
    if (announcementTimer) clearTimeout(announcementTimer)
    if (!searching.value) {
      announcedResult.value = announcement
      return
    }
    announcementTimer = setTimeout(() => {
      announcedResult.value = announcement
    }, 300)
  },
  { immediate: true },
)
onUnmounted(() => {
  if (announcementTimer) clearTimeout(announcementTimer)
})

useCustomHighlight({
  highlightName: 'skill-search',
  term: searchTerm,
  selector: '.skill-row-name, .skill-group-chip-name',
})

function skillLevelCells(skill: IndexedSkill) {
  return levelCells(skill, queuedLevels.value.get(skill.typeId) ?? 0)
}

function skillLevelDescription(skill: IndexedSkill) {
  return levelDescription(skill, queuedLevels.value.get(skill.typeId) ?? 0)
}

function skillIsInjectedOnly(skill: IndexedSkill) {
  return isInjectedOnly(skill, queuedLevels.value.get(skill.typeId) ?? 0)
}

function groupLabel(group: GroupSummary) {
  const skillLabel = group.count === 1 ? 'catalogue skill' : 'catalogue skills'
  return `${group.name}, ${group.count} ${skillLabel}, ${group.progressPercent}% of skill levels trained`
}

function pluralize(count: number, singular: string, plural: string) {
  return count === 1 ? singular : plural
}
</script>

<template>
  <div class="skills-catalogue-body">
    <div class="skills-filter-bar">
      <UiToolbar class="skills-toolbar" label="Skills search">
        <input
          v-model="search"
          type="search"
          autocomplete="off"
          placeholder="Search skills or groups"
          aria-label="Search catalogue skills by skill or group name"
        />
      </UiToolbar>
      <span
        class="app-search-status skills-match-status"
        :class="{ 'is-visible': resultsRefined }"
        aria-hidden="true"
      >
        {{ compactResultStatus }}
      </span>
      <div class="skills-filter-controls">
        <fieldset class="skills-level-filter">
          <legend class="sr-only">Filter skills by trained level</legend>
          <button
            v-for="filter in levelFilters"
            :key="filter.id"
            type="button"
            :class="{ 'is-selected': levelFilter === filter.id }"
            :aria-pressed="levelFilter === filter.id"
            @click="levelFilter = filter.id"
          >
            {{ filter.label }}
          </button>
        </fieldset>
        <button
          type="button"
          class="skills-queued-filter"
          :class="{ 'is-selected': queuedOnly }"
          :disabled="queuedFilterDisabled"
          :aria-pressed="queuedOnly"
          :aria-label="queuedFilterLabel"
          @click="queuedOnly = !queuedOnly"
        >
          QUEUED ONLY
        </button>
      </div>
      <span class="sr-only skills-result-announcement" aria-live="polite">
        {{ announcedResult }}
      </span>
    </div>

    <output
      v-if="skills.injectedSkillCount === 0 && skills.groups.length > 0"
      class="skill-catalogue-notice"
    >
      <span class="ui-eyebrow">00 / NO INJECTED SKILLS</span>
      This character has no injected skills. The complete catalogue is shown at level 0.
    </output>

    <UiStatePanel
      v-if="skills.groups.length === 0"
      code="NO CATALOGUE"
      title="Skill catalogue unavailable"
      compact
      role="status"
    >
      <p>No published skills are available. Retry after static data ingestion completes.</p>
    </UiStatePanel>

    <template v-else>
      <fieldset class="skill-group-chips">
        <legend class="sr-only">Skill groups</legend>
        <button
          v-for="group in groupSummaries"
          :key="group.key"
          type="button"
          class="skill-group-chip"
          :class="{
            'is-selected': group.key === activeGroupKey,
            'is-vacant': group.count === 0,
            'is-unknown': group.groupId === null,
          }"
          :style="{ '--skill-group-progress': `${group.progressPercent}%` }"
          :disabled="group.count === 0"
          :aria-label="groupLabel(group)"
          :aria-pressed="group.key === activeGroupKey"
          @click="selectGroup(group.key)"
        >
          <CharacterSkillsGroupIcon :name="group.icon" />
          <span class="skill-group-chip-name">{{ group.name }}</span>
          <span class="skill-group-chip-count">{{ group.count }}</span>
        </button>
      </fieldset>

      <div class="skill-list-panel">
        <div class="skill-list-header">
          <h2>{{ listTitle }}</h2>
          <span class="skill-list-meta">{{ listMeta }}</span>
          <span class="skill-level-legend" aria-label="Skill level indicator legend">
            <span><i class="is-active" aria-hidden="true" />ACTIVE</span>
            <span><i class="is-trained" aria-hidden="true" />TRAINED</span>
            <span><i class="is-queued" aria-hidden="true" />QUEUED</span>
            <span><i class="is-injected" aria-hidden="true" />INJECTED</span>
          </span>
          <span
            class="skill-list-sp"
            :aria-label="`${rowsSp.toLocaleString('en-US')} trained skill points`"
          >
            {{ rowsSp.toLocaleString('en-US') }} TRAINED SP
          </span>
        </div>

        <ul v-if="rows.length" class="skill-list">
          <li
            v-for="skill in rows"
            :key="skill.typeId"
            class="skill-row"
            :class="{ 'is-injected': skillIsInjectedOnly(skill) }"
          >
            <span class="skill-level-track" :aria-label="skillLevelDescription(skill)">
              <i
                v-for="cell in skillLevelCells(skill)"
                :key="cell.level"
                :class="{
                  'is-active': cell.active,
                  'is-trained': cell.trained,
                  'is-queued': cell.queued,
                }"
                aria-hidden="true"
              />
            </span>
            <span
              class="skill-row-name"
              :class="{ 'is-revealed': revealedSkillNameId === skill.typeId }"
              :data-full-name="skill.name"
              @mouseenter="revealTruncatedSkillName(skill.typeId, $event)"
              @mouseleave="hideSkillName(skill.typeId)"
            >
              {{ skill.name }}
            </span>
            <span
              class="skill-row-sp"
              :aria-label="`${skill.skillpoints.toLocaleString('en-US')} trained skill points`"
            >
              {{ skill.skillpoints.toLocaleString('en-US') }} SP
            </span>
            <span
              class="skill-row-level"
              :class="{ 'is-partial': skill.activeLevel < skill.trainedLevel }"
              :aria-label="`Trained level ${skill.trainedLevel}`"
            >
              {{ romanLevel(skill.trainedLevel) }}
            </span>
          </li>
        </ul>

        <div v-else class="skill-list-empty">
          <span class="ui-eyebrow">00 / NO MATCHES</span>
          <p v-if="searching">No skills match "{{ searchTerm }}".</p>
          <p v-else>No skills match the current filter.</p>
        </div>
      </div>
    </template>
  </div>
</template>
