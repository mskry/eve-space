<script setup lang="ts">
definePageMeta({ title: 'Corporation Overview', layout: 'headerless' })

const { corporation } = useCorporationRecord()
const formattedFounded = computed(() =>
  corporation.value?.dateFounded ? formatBirthday(corporation.value.dateFounded) : '—',
)
const founder = computed(() => {
  const record = corporation.value
  if (!record || record.creatorId === null || record.creatorId === record.ceoId) return undefined
  return { id: record.creatorId, name: record.creatorName ?? `ID ${record.creatorId}` }
})
const ceoLabel = computed(() => {
  const record = corporation.value
  if (!record || record.ceoId === null) return 'CEO'
  return record.ceoId === record.creatorId ? 'CEO · FOUNDER' : 'CEO'
})
const statusBadges = computed(() => {
  const record = corporation.value
  if (!record) return []

  if (record.type === 'npc_owned') {
    return [{ id: 'type', label: 'NPC', tone: 'off' }]
  }

  const badges = [
    {
      id: 'state',
      label: record.state.toUpperCase(),
      tone: record.state === 'active' ? 'on' : 'alert',
    },
  ]

  badges.push(
    {
      id: 'war',
      label: record.warEligible ? 'WAR ELIGIBLE' : 'WAR INELIGIBLE',
      tone: record.warEligible ? 'warn' : 'off',
    },
    {
      id: 'friendly-fire',
      label: `FF ${record.friendlyFire === 'legal' ? 'On' : 'Off'}`,
      tone: record.friendlyFire === 'legal' ? 'warn' : 'off',
    },
  )
  return badges
})

function formatTaxRate(taxRate: number) {
  return taxRate.toLocaleString('en-US', {
    minimumFractionDigits: 1,
    maximumFractionDigits: 2,
  })
}
</script>

<template>
  <article v-if="corporation" class="dossier">
    <div class="identity-panel">
      <div class="corporation-dossier-badges">
        <span
          v-for="badge in statusBadges"
          :key="badge.id"
          class="corporation-dossier-badge"
          :data-tone="badge.tone"
          >{{ badge.label }}</span
        >
      </div>
      <div class="corporation-body" aria-label="Corporation dossier">
        <div class="overview-bio-card corporation-bio">
          <span class="card-index">01</span>
          <p>DESCRIPTION</p>
          <div class="overview-bio-copy">
            {{ corporation.description || 'No public description.' }}
          </div>
          <p v-if="corporation.url" class="corporation-url">
            {{ corporation.url }}
          </p>
        </div>
        <div class="corporation-side">
          <section class="character-detail-group character-detail-group--profile">
            <span class="card-index">02</span>
            <h2>PROFILE</h2>
            <dl>
              <div class="profile-col-start">
                <dt>MEMBERS</dt>
                <dd>{{ corporation.memberCount.toLocaleString('en-US') }}</dd>
              </div>
              <div class="profile-col-end">
                <dt>FOUNDED</dt>
                <dd>{{ formattedFounded }}</dd>
              </div>
              <div class="profile-col-start">
                <dt>ISK TAX</dt>
                <dd>{{ formatTaxRate(corporation.taxRate) }}%</dd>
              </div>
              <div class="profile-col-end">
                <dt>LP TAX</dt>
                <dd>{{ formatTaxRate(corporation.loyaltyPointTaxRate) }}%</dd>
              </div>
              <div
                v-if="corporation.shares !== null && corporation.shares !== 0"
                class="profile-wide"
              >
                <dt>SHARES</dt>
                <dd>{{ corporation.shares.toLocaleString('en-US') }}</dd>
              </div>
              <div
                v-if="corporation.ceoId !== null"
                class="profile-col-start corporation-profile-leader--ceo"
              >
                <dt>{{ ceoLabel }}</dt>
                <dd>
                  <NuxtLink
                    class="corporation-character-link"
                    :to="`/character/${corporation.ceoId}`"
                  >
                    <UiEveImage
                      kind="character"
                      :id="corporation.ceoId"
                      :dimension="32"
                      :width="32"
                      :height="32"
                      loading="lazy"
                      decoding="async"
                      :alt="`${corporation.ceoName ?? `CEO ${corporation.ceoId}`} portrait`"
                    />
                    <span>{{ corporation.ceoName ?? `ID ${corporation.ceoId}` }}</span>
                  </NuxtLink>
                </dd>
              </div>
              <div v-if="founder" class="profile-col-end corporation-profile-leader--founder">
                <dt>FOUNDER</dt>
                <dd>
                  <NuxtLink class="corporation-character-link" :to="`/character/${founder.id}`">
                    <UiEveImage
                      kind="character"
                      :id="founder.id"
                      :dimension="32"
                      :width="32"
                      :height="32"
                      loading="lazy"
                      decoding="async"
                      :alt="`${founder.name} portrait`"
                    />
                    <span>{{ founder.name }}</span>
                  </NuxtLink>
                </dd>
              </div>
              <div v-if="corporation.homeStationId" class="profile-wide">
                <dt>HOME STATION</dt>
                <dd>{{ corporation.homeStationName ?? corporation.homeStationId }}</dd>
              </div>
            </dl>
          </section>
        </div>
      </div>
    </div>
  </article>
</template>

<style>
@import url('~/assets/css/features/record-dossier.css');
</style>

<style scoped>
.corporation-dossier-badges {
  margin-bottom: 1rem;
  display: flex;
  flex-wrap: wrap;
  justify-content: flex-end;
  gap: 0.4375rem;
}

.corporation-dossier-badge {
  padding: 0.375rem 0.625rem;
  border: 0.0625rem solid var(--ui-border-strong);
  color: var(--ui-text-muted);
  font: 700 0.625rem/1 var(--ui-font-mono);
  letter-spacing: 0.14em;
}

.corporation-dossier-badge[data-tone='on'] {
  border-color: color-mix(in srgb, var(--ui-success) 42%, transparent);
  background: color-mix(in srgb, var(--ui-success) 8%, transparent);
  color: var(--ui-success);
}

.corporation-dossier-badge[data-tone='warn'] {
  border-color: color-mix(in srgb, var(--ui-warning) 44%, transparent);
  background: color-mix(in srgb, var(--ui-warning) 8%, transparent);
  color: var(--ui-warning);
}

.corporation-dossier-badge[data-tone='alert'] {
  border-color: color-mix(in srgb, var(--ui-danger) 44%, transparent);
  background: color-mix(in srgb, var(--ui-danger) 8%, transparent);
  color: var(--ui-danger);
}

.corporation-body {
  display: grid;
  grid-template-columns: minmax(0, 1.35fr) minmax(0, 1fr);
  border-top: 0.0625rem solid var(--ui-border);
  border-bottom: 0.0625rem solid var(--ui-border);
}

.corporation-bio {
  border-right: 0.0625rem solid var(--ui-border);
}

.corporation-bio .overview-bio-copy {
  max-height: none;
}

.corporation-side {
  display: grid;
  min-width: 0;
}

.corporation-side .affiliation-card,
.corporation-side .character-detail-group {
  border-right: 0;
}

.character-detail-group--profile {
  position: relative;
}

.character-detail-group--profile dl {
  display: grid;
  grid-template-columns: 1fr 1fr;
}

.character-detail-group--profile .profile-col-start {
  padding-right: 0.75rem;
}

.character-detail-group--profile .profile-col-end {
  padding-left: 0.75rem;
}

.character-detail-group--profile .profile-wide {
  grid-column: 1 / -1;
  padding-right: 0;
  padding-left: 0;
}

.corporation-url {
  display: inline-block;
  margin-top: 0.625rem;
  font: 0.75rem/1 var(--ui-font-mono);
  word-break: break-all;
}

.corporation-character-link {
  display: inline-flex;
  align-items: center;
  gap: 0.5rem;
  color: inherit;
  text-decoration: none;
}

.corporation-character-link:hover {
  color: var(--ui-primary);
}

.corporation-character-link:focus-visible {
  outline: 0.125rem solid var(--ui-primary);
  outline-offset: 0.1875rem;
}

.corporation-character-link img {
  border: 0.0625rem solid var(--ui-border);
}

@media (max-width: 56.25rem) {
  .corporation-dossier-badges {
    justify-content: flex-start;
  }

  .corporation-body {
    grid-template-columns: 1fr;
    border-bottom: 0;
  }

  .corporation-bio {
    border-right: 0;
    border-bottom: 0.0625rem solid var(--ui-border);
  }

  .corporation-side {
    border-bottom: 0.0625rem solid var(--ui-border);
  }
}
</style>
