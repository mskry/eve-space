<script setup lang="ts">
import Fuse, { type IFuseOptions } from 'fuse.js'
import { useQuery } from '@pinia/colada'
import { characterSkillsQuery } from '../../../queries/characters'
import { canRunProtectedQuery } from '../../../queries/query-cache'
import { ApiQueryError } from '../../../utils/query-error'
import { parseRouteId } from '../../../utils/route-id'

definePageMeta({ title: 'Character Skills', layout: 'headerless' })

const route = useRoute()
const runtimeConfig = useRuntimeConfig()
const apiClient = createApiClient(runtimeConfig.public.apiBase)
const { authSession } = useAuthSession(apiClient)
const characterId = computed(() => parseRouteId(route.params.characterId))
const skillsQuery = useQuery(() => ({
  ...characterSkillsQuery({ apiClient, characterId: characterId.value ?? 0 }),
  enabled: canRunProtectedQuery(
    import.meta.client,
    authSession.value.authenticated,
    characterId.value,
  ),
}))
const skills = skillsQuery.data
const skillsMessage = computed(() =>
  skillsQuery.error.value instanceof Error ? skillsQuery.error.value.message : '',
)
const skillsAuthorizeUrl = computed(() =>
  skillsQuery.error.value instanceof ApiQueryError
    ? (skillsQuery.error.value.authorizeUrl ?? '')
    : '',
)
const skillsStatus = computed(() => {
  if (skillsQuery.data.value) return 'idle'
  const error = skillsQuery.error.value
  if (error instanceof ApiQueryError && error.status === 404) return 'not-found'
  if (
    error instanceof ApiQueryError &&
    (error.code === 'EVE_SCOPE_REQUIRED' || error.code === 'EVE_REAUTH_REQUIRED')
  ) {
    return 'scope-required'
  }
  if (skillsQuery.status.value === 'error') return 'error'
  if (skillsQuery.asyncStatus.value === 'loading') return 'loading'
  return 'idle'
})

function loadCharacterSkills(force = false) {
  return force ? skillsQuery.refetch() : skillsQuery.refresh()
}

useCharacterReauthorization(characterId, () => void skillsQuery.refetch())

const totalSpLabel = computed(() => skills.value?.totalSp.toLocaleString('en-US') ?? '0')
const unallocatedSpLabel = computed(
  () => skills.value?.unallocatedSp.toLocaleString('en-US') ?? '0',
)
const levelFiveSummary = computed(() => {
  let count = 0
  let skillpoints = 0

  for (const group of skills.value?.groups ?? []) {
    for (const skill of group.skills) {
      if (skill.trainedLevel !== 5) continue
      count += 1
      skillpoints += skill.skillpoints
    }
  }

  return { count, skillpoints: skillpoints.toLocaleString('en-US') }
})
const search = ref('')
const searchTerm = computed(() => search.value.trim())
useCustomHighlight({
  highlightName: 'skill-search',
  term: searchTerm,
  selector: '.skill-group-name, .skill-identity strong',
})
const fuseOptions: IFuseOptions<Record<string, unknown>> = {
  keys: ['name'],
  threshold: 0.18,
  ignoreLocation: true,
  minMatchCharLength: 2,
}

function fuzzyContains(name: string, token: string): boolean {
  if (!name || !token) return false
  const fuse = new Fuse([{ name }], fuseOptions as IFuseOptions<{ name: string }>)
  return fuse.search(token).length > 0
}

function groupMatchesAllTokens(name: string, tokens: string[]): boolean {
  return tokens.every((tok) => fuzzyContains(name, tok))
}

const filteredGroups = computed(() => {
  const groups = skills.value?.groups ?? []
  const raw = searchTerm.value
  if (!raw) return groups
  const tokens = raw.toLowerCase().split(/\s+/).filter(Boolean)
  if (tokens.length === 0) return groups
  return groups.flatMap((group) => {
    if (groupMatchesAllTokens(group.name ?? '', tokens)) return [group]
    const hits = group.skills.filter((skill) => groupMatchesAllTokens(skill.name ?? '', tokens))
    if (hits.length) {
      return [
        { ...group, skills: hits, trainedSp: hits.reduce((sum, s) => sum + s.skillpoints, 0) },
      ]
    }
    return []
  })
})
const filteredSkillCount = computed(() =>
  filteredGroups.value.reduce((sum, g) => sum + g.skills.length, 0),
)
const skillGroupColumns = computed(() => {
  const groups = filteredGroups.value.map((group, index) => ({ group, index }))
  const midpoint = Math.ceil(groups.length / 2)
  return [groups.slice(0, midpoint), groups.slice(midpoint)]
})
</script>

<template>
  <section class="character-skills-route">
    <UiStatePanel v-if="skillsStatus === 'loading' && !skills" compact role="status">
      <template #icon><div class="app-scanner" aria-hidden="true" /></template>
      <p>Decrypting trained skill archive...</p>
    </UiStatePanel>
    <CharacterAuthorizationRequired
      v-else-if="skillsStatus === 'scope-required'"
      title="Skills authorization required"
      :message="skillsMessage"
      :authorize-url="skillsAuthorizeUrl"
    />
    <UiStatePanel
      v-else-if="skillsStatus === 'error' || skillsStatus === 'not-found'"
      :code="skillsStatus === 'not-found' ? '404' : 'ERR / SKILLS'"
      title="Skill archive unavailable"
      compact
      role="alert"
      tone="error"
    >
      <p>{{ skillsMessage }}</p>
      <template #action>
        <button class="ui-action-secondary" type="button" @click="loadCharacterSkills(true)">
          RETRY UPLINK
        </button>
      </template>
    </UiStatePanel>

    <template v-else-if="skills">
      <CharacterSummaryCard>
        <template #icon>
          <UiEveImage kind="type-icon" :id="3300" :dimension="42" alt="" aria-hidden="true" />
        </template>
        <template #eyebrow>CHARACTER SKILLS</template>
        <template #value>{{ totalSpLabel }} SP</template>
        <template #label>TOTAL SKILL POINTS</template>

        <dl class="skills-summary-stats skills-summary-stats--inline">
          <div>
            <dt>UNALLOCATED</dt>
            <dd>{{ unallocatedSpLabel }} SP</dd>
          </div>
          <div>
            <dt>LEVEL V SKILLS</dt>
            <dd>{{ levelFiveSummary.count }}</dd>
          </div>
          <div>
            <dt>SP IN LEVEL V</dt>
            <dd>{{ levelFiveSummary.skillpoints }} SP</dd>
          </div>
        </dl>
        <div class="skill-level-legend" aria-label="Skill level indicator legend">
          <span><i class="is-active" aria-hidden="true" />ACTIVE</span>
          <span><i class="is-trained" aria-hidden="true" />TRAINED</span>
        </div>
      </CharacterSummaryCard>

      <div class="skills-search-row">
        <span class="app-search-status skills-search-status" aria-live="polite">
          <template v-if="!searchTerm">&nbsp;</template>
          <template v-else-if="filteredGroups.length === 0">NO MATCHES</template>
          <template v-else
            >{{ filteredGroups.length }} / {{ skills.groups.length }} GROUPS MATCHED</template
          >
        </span>
        <UiToolbar class="skills-toolbar" label="Skills search">
          <input
            v-model="search"
            type="search"
            autocomplete="off"
            placeholder="Search skills or groups"
            aria-label="Search skills by name or group"
          />
        </UiToolbar>
      </div>

      <UiStatePanel
        v-if="skills.groups.length === 0"
        code="00 / NO RECORDS"
        title="No trained skills returned"
        compact
      >
        <p>This character's authorized ESI skill archive is currently empty.</p>
      </UiStatePanel>

      <UiStatePanel
        v-else-if="filteredGroups.length === 0"
        code="00 / NO MATCHES"
        title="No matching skills"
        compact
      >
        <p>No groups or skills match "{{ searchTerm }}".</p>
      </UiStatePanel>

      <div v-else class="skill-groups">
        <div
          v-for="(column, columnIndex) in skillGroupColumns"
          :key="columnIndex"
          class="skill-group-column"
        >
          <TransitionGroup name="skill-group">
            <UiCollapsible
              v-for="entry in column"
              :key="`${entry.group.groupId ?? 'unknown'}-${entry.index}-${searchTerm}`"
              class="skill-group"
              :class="{ 'skill-group--unknown': entry.group.groupId === null }"
              :default-open="Boolean(searchTerm)"
            >
              <template #trigger>
                <button class="skill-group-trigger" type="button">
                  <span class="skill-group-heading">
                    <span>{{ String(entry.index + 1).padStart(2, '0') }} / SKILL GROUP</span>
                    <h2 class="skill-group-name">{{ entry.group.name }}</h2>
                    <span v-if="entry.group.groupId === null" class="skill-group-warning">
                      Static data unavailable for these skill IDs.
                    </span>
                  </span>
                  <strong>{{ entry.group.trainedSp.toLocaleString('en-US') }} SP</strong>
                  <span class="skill-group-toggle" aria-hidden="true" />
                </button>
              </template>
              <ul class="skill-list">
                <li v-for="skill in entry.group.skills" :key="skill.typeId" class="skill-row">
                  <div class="skill-identity">
                    <strong>{{ skill.name }}</strong>
                    <span>{{ skill.skillpoints.toLocaleString('en-US') }} SP</span>
                  </div>
                  <div class="skill-levels">
                    <div
                      class="skill-level-track"
                      :aria-label="`Active level ${skill.activeLevel}; trained level ${skill.trainedLevel} of 5`"
                    >
                      <span
                        v-for="level in 5"
                        :key="level"
                        :class="{
                          'is-trained': level <= skill.trainedLevel,
                          'is-active': level <= skill.activeLevel,
                        }"
                        aria-hidden="true"
                      />
                    </div>
                  </div>
                </li>
              </ul>
            </UiCollapsible>
          </TransitionGroup>
        </div>
      </div>
    </template>
  </section>
</template>

<style>
@import url('~/assets/css/features/skills.css');
@import url('~/assets/css/responsive/skills.css');
</style>
