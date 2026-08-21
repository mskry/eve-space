<script setup lang="ts">
import { useQuery } from '@pinia/colada'
import { characterSkillsQuery } from '../../../queries/characters'
import { canRunProtectedQuery } from '../../../queries/query-cache'
import { ApiQueryError } from '../../../utils/query-error'

definePageMeta({ title: 'Character Skills' })

const route = useRoute()
const runtimeConfig = useRuntimeConfig()
const apiClient = createApiClient(runtimeConfig.public.apiBase)
const { typeImage } = useEveImages()
const { authSession } = useAuthSession(apiClient)
const characterId = computed(() => {
  const value = Array.isArray(route.params.characterId)
    ? route.params.characterId[0]
    : route.params.characterId
  const parsed = Number(value)
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : undefined
})
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

watch(
  [characterId, () => route.query.reauthorize],
  ([id, reauthorize]) => {
    if (id && reauthorize === 'success') void skillsQuery.refetch()
  },
  { immediate: true },
)

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
const skillGroupColumns = computed(() => {
  const groups = (skills.value?.groups ?? []).map((group, index) => ({ group, index }))
  const midpoint = Math.ceil(groups.length / 2)
  return [groups.slice(0, midpoint), groups.slice(midpoint)]
})
</script>

<template>
  <section class="character-skills-route">
    <div
      v-if="skillsStatus === 'loading' && !skills"
      class="state-panel compact-state"
      aria-live="polite"
    >
      <div class="scanner" aria-hidden="true" />
      <p>Decrypting trained skill archive...</p>
    </div>
    <div v-else-if="skillsStatus === 'scope-required'" class="skills-access-state" role="status">
      <span class="private-badge">SCOPE REQUIRED</span>
      <div>
        <h2>Skills authorization required</h2>
        <p>{{ skillsMessage }}</p>
      </div>
      <a class="primary-action" :href="skillsAuthorizeUrl">AUTHORIZE THIS CHARACTER</a>
    </div>
    <div
      v-else-if="skillsStatus === 'error' || skillsStatus === 'not-found'"
      class="state-panel error-panel compact-state"
      role="alert"
    >
      <span class="error-code">{{ skillsStatus === 'not-found' ? '404' : 'ERR / SKILLS' }}</span>
      <h2>Skill archive unavailable</h2>
      <p>{{ skillsMessage }}</p>
      <button class="secondary-action" type="button" @click="loadCharacterSkills(true)">
        RETRY UPLINK
      </button>
    </div>

    <template v-else-if="skills">
      <CharacterSummaryCard>
        <template #icon>
          <img src="/images/eve-skillbook.png" alt="" />
        </template>
        <template #eyebrow>CHARACTER SKILLS</template>
        <template #value>{{ totalSpLabel }}</template>
        <template #label>SKILL POINTS</template>

        <dl class="skills-summary-stats">
          <div>
            <dt>GROUPS</dt>
            <dd>{{ skills.groups.length }}</dd>
          </div>
          <div>
            <dt>UNALLOCATED</dt>
            <dd class="skill-injector-value">
              <img :src="typeImage(40520, 'icon', 32)" alt="" />
              <span>{{ unallocatedSpLabel }} SP</span>
            </dd>
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

      <div v-if="skills.groups.length === 0" class="skills-empty">
        <span>00 / NO RECORDS</span>
        <h2>No trained skills returned</h2>
        <p>This character's authorized ESI skill archive is currently empty.</p>
      </div>

      <div v-else class="skill-groups">
        <div
          v-for="(column, columnIndex) in skillGroupColumns"
          :key="columnIndex"
          class="skill-group-column"
        >
          <UiCollapsible
            v-for="entry in column"
            :key="entry.group.groupId ?? 'unknown'"
            class="skill-group"
            :class="{ 'skill-group--unknown': entry.group.groupId === null }"
            :default-open="entry.index === 0"
          >
            <template #trigger>
              <button class="skill-group-trigger" type="button">
                <span class="skill-group-heading">
                  <span>{{ String(entry.index + 1).padStart(2, '0') }} / SKILL GROUP</span>
                  <span class="skill-group-name" role="heading" aria-level="2">{{
                    entry.group.name
                  }}</span>
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
        </div>
      </div>
    </template>
  </section>
</template>
