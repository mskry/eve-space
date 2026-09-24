<script setup lang="ts">
interface CharacterOverviewProfile {
  achievementScore: number
  birthday: string
  bloodline: string
  corporationTitle?: string | null
  factionId?: number | null
  gender: string
  race: string
  securityStatus: number
}

const props = defineProps<{
  profile: CharacterOverviewProfile
  skillPointsLabel?: string
}>()

const formattedBirthday = computed(() => formatBirthday(props.profile.birthday))
const genderSymbol = computed(() => {
  const gender = props.profile.gender.toLowerCase()
  if (gender === 'female') {
    return '♀'
  }
  if (gender === 'male') {
    return '♂'
  }
  return '—'
})
</script>

<template>
  <section class="character-overview-detail-card character-overview-record-detail-card">
    <span class="card-index">02</span>
    <section class="character-overview-detail-section character-overview-detail-section--identity">
      <h2>IDENTITY</h2>
      <dl>
        <div class="character-detail-wide">
          <dt>SECURITY STATUS</dt>
          <dd><SecurityStatus :value="profile.securityStatus" /></dd>
        </div>
        <div class="character-detail-col-start">
          <dt>RACE</dt>
          <dd>{{ profile.race }}</dd>
        </div>
        <div class="character-detail-col-end">
          <dt>BLOODLINE</dt>
          <dd>{{ profile.bloodline }}</dd>
        </div>
        <div class="character-detail-col-start">
          <dt>DATE OF BIRTH</dt>
          <dd>{{ formattedBirthday }}</dd>
        </div>
        <div class="character-detail-col-end">
          <dt>GENDER</dt>
          <dd>
            <span class="gender-symbol" :title="profile.gender" aria-hidden="true">
              {{ genderSymbol }}
            </span>
            <span class="sr-only">{{ profile.gender }}</span>
          </dd>
        </div>
        <div v-if="profile.factionId" class="character-detail-wide">
          <dt>FACTION</dt>
          <dd>
            <UiEveImage
              kind="faction"
              :id="profile.factionId"
              :dimension="32"
              :width="32"
              :height="32"
              loading="lazy"
              decoding="async"
              alt="Faction militia emblem"
            />
          </dd>
        </div>
        <div v-if="profile.corporationTitle" class="character-detail-wide">
          <dt>CORPORATION TITLE</dt>
          <dd>{{ profile.corporationTitle }}</dd>
        </div>
      </dl>
    </section>
    <section
      class="character-overview-detail-section character-overview-detail-section--progression"
    >
      <h2>PROGRESSION</h2>
      <dl>
        <div v-if="skillPointsLabel" class="character-detail-primary">
          <dt>TOTAL SKILL POINTS</dt>
          <dd>{{ skillPointsLabel }}</dd>
        </div>
        <div>
          <dt>ACHIEVEMENT SCORE</dt>
          <dd>{{ profile.achievementScore.toLocaleString('en-US') }}</dd>
        </div>
      </dl>
    </section>
  </section>
</template>
