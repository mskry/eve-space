<script setup lang="ts">
import Fuse from 'fuse.js'
import type { CharacterSkillQueue, CharacterSkills } from '../../../queries/characters'
import { queuedLevelsByType, romanLevel } from '../../../utils/skill-queue'
import {
  groupKeyOf,
  indexSkills,
  levelCells,
  levelDescription,
  resolveActiveGroupKey,
  selectVisibleSkills,
  summariseGroups,
  type IndexedSkill,
} from '../../../utils/skill-catalogue'

const props = defineProps<{
  skills: CharacterSkills
  skillQueue: CharacterSkillQueue | undefined
}>()

const search = ref('')
const searchTerm = computed(() => search.value.trim())
const searchTokens = computed(() => searchTerm.value.toLowerCase().split(/\s+/).filter(Boolean))
const searching = computed(() => searchTokens.value.length > 0)
const levelFilter = ref<'all' | 'partial' | 'v'>('all')
const levelFilters = [
  { id: 'all', label: 'ALL' },
  { id: 'partial', label: 'BELOW V' },
  { id: 'v', label: 'AT V' },
] as const
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
const visibleSkills = computed(() =>
  selectVisibleSkills(indexedSkills.value, levelFilter.value, searchMatches.value),
)
const groupSummaries = computed(() => summariseGroups(groups.value, visibleSkills.value))
const selectedGroupKey = ref<string | null>(null)
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
    ? `${rows.value.length} SKILLS ACROSS ${rowsGroupCount.value} GROUPS`
    : `${rows.value.length} SKILLS / ${rowsAtFive.value} AT V`,
)
const matchLabel = computed(() =>
  searching.value
    ? `${rows.value.length} SKILLS MATCHED`
    : `${groups.value.length} GROUPS / ${indexedSkills.value.length} SKILLS`,
)

useCustomHighlight({
  highlightName: 'skill-search',
  term: searchTerm,
  selector: '.skill-row-name, .skill-group-chip-name',
})

const queuedLevels = computed(() => queuedLevelsByType(props.skillQueue))

function skillLevelCells(skill: IndexedSkill) {
  return levelCells(skill, queuedLevels.value.get(skill.typeId) ?? 0)
}

function skillLevelDescription(skill: IndexedSkill) {
  return levelDescription(skill, queuedLevels.value.get(skill.typeId) ?? 0)
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
          aria-label="Search skills by name or group"
        />
      </UiToolbar>
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
      <span class="app-search-status skills-match-status" aria-live="polite">
        {{ matchLabel }}
      </span>
    </div>

    <UiStatePanel
      v-if="skills.groups.length === 0"
      code="00 / NO RECORDS"
      title="No trained skills returned"
      compact
    >
      <p>This character's authorized ESI skill archive is currently empty.</p>
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
          :disabled="group.count === 0"
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
          </span>
          <span class="skill-list-sp">{{ rowsSp.toLocaleString('en-US') }} SP</span>
        </div>

        <ul v-if="rows.length" class="skill-list">
          <li v-for="skill in rows" :key="skill.typeId" class="skill-row">
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
            <span class="skill-row-name">{{ skill.name }}</span>
            <span class="skill-row-sp">{{ skill.skillpoints.toLocaleString('en-US') }} SP</span>
            <span
              class="skill-row-level"
              :class="{ 'is-partial': skill.activeLevel < skill.trainedLevel }"
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
