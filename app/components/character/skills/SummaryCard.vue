<script setup lang="ts">
import type { CharacterAttributes, CharacterSkills } from '../../../queries/characters'
import type { EsiResourceState } from '../../../types/esi-resource'

const props = defineProps<{
  skills: CharacterSkills
  attributes: CharacterAttributes | undefined
  attributesStatus: string
  attributesMessage: string
  attributesAuthorizeUrl: string
}>()

const emit = defineEmits<{ retryAttributes: [] }>()

const totalSpLabel = computed(() => props.skills.totalSp.toLocaleString('en-US'))

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
const attributesResourceState = computed<EsiResourceState>(() => {
  if (props.attributesStatus === 'loading') {
    return { status: 'loading', title: '', message: 'Loading attributes...' }
  }
  if (props.attributesStatus === 'scope-required') {
    return {
      status: 'authorization-required',
      code: 'ESI 403 / ATTRIBUTES',
      title: 'Attributes not authorized',
      message: props.attributesMessage,
      action: props.attributesAuthorizeUrl
        ? { href: props.attributesAuthorizeUrl, label: 'AUTHORIZE' }
        : null,
    }
  }
  if (props.attributesStatus === 'error') {
    return {
      status: 'error',
      title: 'Attributes unavailable',
      message: props.attributesMessage,
      retryLabel: 'RETRY',
    }
  }
  return { status: 'ready' }
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
      <dl v-if="remapAvailability" class="character-summary-stats">
        <div v-if="remapAvailability.kind === 'bonus'">
          <dt>REMAPS AVAILABLE</dt>
          <dd>{{ remapAvailability.count }}</dd>
        </div>
        <div v-else-if="remapAvailability.kind === 'cooldown'">
          <dt>NEXT REMAP</dt>
          <dd>
            <time :datetime="remapAvailability.date">
              {{ formatDate(remapAvailability.date) }}
            </time>
          </dd>
        </div>
        <div v-else>
          <dt>REMAP</dt>
          <dd>AVAILABLE</dd>
        </div>
      </dl>

      <div
        class="skills-hero-profile"
        aria-labelledby="skill-attribute-band-title"
        :aria-busy="attributesStatus === 'loading'"
      >
        <span id="skill-attribute-band-title" class="ui-eyebrow">ATTRIBUTES</span>
        <EsiResourceBoundary
          :state="attributesResourceState"
          :has-data="Boolean(attributes)"
          @retry="emit('retryAttributes')"
        >
          <template #loading>
            <p class="skill-attribute-notice">Loading attributes...</p>
          </template>
          <template #error="{ state }">
            <p class="skill-attribute-notice">
              {{ state.message }}
              <button type="button" @click="emit('retryAttributes')">RETRY</button>
            </p>
          </template>
          <dl v-if="attributes" class="skill-attribute-cells">
            <div v-for="attribute in attributeCells" :key="attribute.key">
              <img :src="attribute.icon" alt="" aria-hidden="true" width="18" height="18" />
              <dt>{{ attribute.label }}</dt>
              <dd>{{ attribute.value }}</dd>
            </div>
          </dl>
        </EsiResourceBoundary>
      </div>
    </div>
  </AppSummaryCard>
</template>
