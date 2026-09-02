<script setup lang="ts">
import type { CharacterAttributes, CharacterSkills } from '../../../queries/characters'

const props = defineProps<{
  skills: CharacterSkills
  attributes: CharacterAttributes | undefined
  attributesStatus: string
  attributesMessage: string
  attributesAuthorizeUrl: string
}>()

const emit = defineEmits<{ retryAttributes: [] }>()

const totalSpLabel = computed(() => props.skills.totalSp.toLocaleString('en-US'))
const unallocatedSpLabel = computed(() => props.skills.unallocatedSp.toLocaleString('en-US'))
const levelFiveCount = computed(() => {
  let count = 0
  for (const group of props.skills.groups) {
    for (const skill of group.skills) if (skill.trainedLevel === 5) count += 1
  }
  return count
})

const attributeDefinitions = [
  { key: 'intelligence', label: 'INT' },
  { key: 'perception', label: 'PER' },
  { key: 'charisma', label: 'CHA' },
  { key: 'willpower', label: 'WIL' },
  { key: 'memory', label: 'MEM' },
] as const
const attributeCells = computed(() => {
  const profile = props.attributes
  return profile
    ? attributeDefinitions.map((attribute) => ({
        key: attribute.key,
        label: attribute.label,
        icon: `/images/eve-attributes/${attribute.key}.png`,
        value: profile[attribute.key],
      }))
    : []
})

const remapAvailability = computed(() => {
  const profile = props.attributes
  if (!profile) return null
  if (profile.bonusRemaps > 0) return { kind: 'bonus' as const, count: profile.bonusRemaps }

  const cooldown = profile.accruedRemapCooldownDate
  if (cooldown && Date.parse(cooldown) > Date.now())
    return { kind: 'cooldown' as const, date: cooldown }
  return { kind: 'available' as const }
})

function formatDate(value: string) {
  return new Intl.DateTimeFormat('en-GB', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    timeZone: 'UTC',
  })
    .format(new Date(value))
    .toUpperCase()
}
</script>

<template>
  <AppSummaryCard class="skills-hero">
    <template #icon>
      <UiEveImage kind="type-icon" :id="3300" :dimension="42" alt="" aria-hidden="true" />
    </template>
    <template #eyebrow>CHARACTER SKILLS</template>
    <template #value>{{ totalSpLabel }} SP</template>
    <template #label>TOTAL SKILL POINTS</template>

    <div class="skills-hero-details">
      <div class="skills-hero-metrics">
        <dl class="skills-hero-stats">
          <div>
            <dt>UNALLOCATED</dt>
            <dd class="is-primary">{{ unallocatedSpLabel }}</dd>
          </div>
          <div>
            <dt>AT LEVEL V</dt>
            <dd>{{ levelFiveCount }}</dd>
          </div>
        </dl>
      </div>

      <div
        class="skills-hero-profile"
        aria-labelledby="skill-attribute-band-title"
        :aria-busy="attributesStatus === 'loading'"
      >
        <span id="skill-attribute-band-title" class="ui-eyebrow">ATTRIBUTES</span>
        <p v-if="attributesStatus === 'loading'" class="skill-attribute-notice">
          Loading attributes...
        </p>
        <p v-else-if="attributesStatus === 'scope-required'" class="skill-attribute-notice">
          Attributes are not authorized.
          <a v-if="attributesAuthorizeUrl" :href="attributesAuthorizeUrl">AUTHORIZE</a>
        </p>
        <p v-else-if="attributesStatus === 'error'" class="skill-attribute-notice">
          {{ attributesMessage }}
          <button type="button" @click="emit('retryAttributes')">RETRY</button>
        </p>
        <template v-else-if="attributes">
          <dl class="skill-attribute-cells">
            <div v-for="attribute in attributeCells" :key="attribute.key">
              <img :src="attribute.icon" alt="" aria-hidden="true" width="18" height="18" />
              <dt>{{ attribute.label }}</dt>
              <dd>{{ attribute.value }}</dd>
            </div>
          </dl>
          <p v-if="remapAvailability" class="skill-attribute-remaps">
            <template v-if="remapAvailability.kind === 'bonus'">
              REMAPS AVAILABLE: {{ remapAvailability.count }}
            </template>
            <template v-else-if="remapAvailability.kind === 'cooldown'">
              NEXT REMAP:
              <time :datetime="remapAvailability.date">
                {{ formatDate(remapAvailability.date) }}
              </time>
            </template>
            <template v-else>REMAP: AVAILABLE</template>
          </p>
        </template>
      </div>
    </div>
  </AppSummaryCard>
</template>
