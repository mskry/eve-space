<script setup lang="ts">
definePageMeta({ title: 'Corporation Overview', layout: 'headerless' })

const { corporation } = useCorporationRecord()
const formattedFounded = computed(() =>
  corporation.value?.dateFounded ? formatBirthday(corporation.value.dateFounded) : '—',
)
</script>

<template>
  <article v-if="corporation" class="dossier">
    <div class="identity-panel">
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
          <section class="character-detail-group character-detail-group--membership">
            <span class="card-index">02</span>
            <h2>CORPORATION</h2>
            <dl>
              <div class="character-detail-primary">
                <dt>MEMBERS</dt>
                <dd>{{ corporation.memberCount.toLocaleString('en-US') }}</dd>
              </div>
              <div class="membership-founded">
                <dt>FOUNDED</dt>
                <dd>{{ formattedFounded }}</dd>
              </div>
              <div
                v-if="corporation.shares !== null && corporation.shares !== 0"
                class="membership-shares"
              >
                <dt>SHARES</dt>
                <dd>{{ corporation.shares.toLocaleString('en-US') }}</dd>
              </div>
              <div v-if="corporation.homeStationId" class="membership-home">
                <dt>HOME STATION</dt>
                <dd>{{ corporation.homeStationName ?? corporation.homeStationId }}</dd>
              </div>
            </dl>
          </section>
          <section class="character-detail-group character-detail-group--leadership">
            <h2>LEADERSHIP</h2>
            <dl>
              <div class="leadership-ceo">
                <dt>CEO</dt>
                <dd class="corporation-ceo">
                  <NuxtLink
                    v-if="corporation.ceoId !== null"
                    class="corporation-character-link"
                    :to="`/character/${corporation.ceoId}`"
                  >
                    <UiEveImage
                      kind="character"
                      :id="corporation.ceoId"
                      :dimension="32"
                      :alt="`${corporation.ceoName ?? `CEO ${corporation.ceoId}`} portrait`"
                    />
                    <span>{{ corporation.ceoName ?? `ID ${corporation.ceoId}` }}</span>
                  </NuxtLink>
                  <span v-else>—</span>
                </dd>
              </div>
              <div v-if="corporation.creatorId !== null" class="leadership-creator">
                <dt>CREATOR</dt>
                <dd class="corporation-ceo">
                  <NuxtLink
                    class="corporation-character-link"
                    :to="`/character/${corporation.creatorId}`"
                  >
                    <UiEveImage
                      kind="character"
                      :id="corporation.creatorId"
                      :dimension="32"
                      :alt="`${corporation.creatorName ?? `Creator ${corporation.creatorId}`} portrait`"
                    />
                    <span>{{ corporation.creatorName ?? `ID ${corporation.creatorId}` }}</span>
                  </NuxtLink>
                </dd>
              </div>
              <div v-if="corporation.allianceId" class="leadership-alliance">
                <dt>ALLIANCE</dt>
                <dd class="corporation-alliance">
                  <UiEveImage
                    kind="alliance"
                    :id="corporation.allianceId"
                    :dimension="32"
                    :alt="`${corporation.allianceName ?? `Alliance ${corporation.allianceId}`} logo`"
                  />
                  <span>{{ corporation.allianceName ?? `ID ${corporation.allianceId}` }}</span>
                </dd>
              </div>
            </dl>
          </section>
        </div>
      </div>
      <footer class="record-footer">
        <a
          :href="`https://evewho.com/corporation/${corporation.corporationId}`"
          target="_blank"
          rel="noreferrer"
        >
          EXTERNAL RECORD ↗
        </a>
      </footer>
    </div>
  </article>
</template>

<style>
@import url('~/assets/css/features/record-dossier.css');
</style>

<style scoped>
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

.character-detail-group--membership {
  position: relative;
}

.character-detail-group--membership dl,
.character-detail-group--leadership dl {
  display: grid;
  grid-template-columns: 1fr 1fr;
}

.character-detail-group--membership .character-detail-primary,
.character-detail-group--membership .membership-home,
.character-detail-group--leadership .leadership-alliance {
  grid-column: 1 / -1;
}

.character-detail-group--membership .membership-founded,
.character-detail-group--leadership .leadership-ceo {
  grid-column: 1;
  padding-right: 0.75rem;
}

.character-detail-group--membership .membership-shares,
.character-detail-group--leadership .leadership-creator {
  grid-column: 2;
  padding-left: 0.75rem;
}

.character-detail-group--membership .membership-founded:has(+ .membership-home),
.character-detail-group--leadership
  .leadership-ceo:not(:has(+ .leadership-creator)):has(+ .leadership-alliance),
.character-detail-group--leadership .leadership-ceo:last-child {
  grid-column: 1 / -1;
  padding-right: 0;
}

.corporation-url {
  display: inline-block;
  margin-top: 0.625rem;
  font: 0.75rem/1 var(--ui-font-mono);
  word-break: break-all;
}

.corporation-ceo,
.corporation-alliance,
.corporation-character-link {
  display: inline-flex;
  align-items: center;
  gap: 0.5rem;
}

.corporation-character-link {
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

.corporation-ceo img,
.corporation-alliance img {
  border: 0.0625rem solid var(--ui-border);
}

.record-footer {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 0.75rem;
  margin-top: 1rem;
  border-top: 0;
}

@media (max-width: 56.25rem) {
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
