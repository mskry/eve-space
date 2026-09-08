<script setup lang="ts">
import type { OrganizationCompliance } from '../queries/organization'
import {
  formatOrganizationTimestamp,
  organizationComplianceDescription,
  organizationComplianceLabels,
  organizationReasonLabel,
  organizationRemediationHref,
  organizationRemediationLabel,
} from '../utils/organization-presentation'

const props = defineProps<{
  compliance: OrganizationCompliance
  apiBase: string
}>()

const remediationActions = computed(() => [
  ...props.compliance.remediationActions.map((action) => ({
    ...action,
    characterId: null,
    characterName: null,
  })),
  ...props.compliance.characters.flatMap((character) =>
    character.remediationActions.map((action) => ({
      ...action,
      characterId: character.characterId,
      characterName: character.characterName,
    })),
  ),
])
</script>

<template>
  <section class="member-compliance" aria-labelledby="member-compliance-heading">
    <div class="member-compliance__state">
      <span class="overview-panel-index">REGISTRATION / {{ compliance.state }}</span>
      <h2 id="member-compliance-heading">{{ organizationComplianceLabels[compliance.state] }}</h2>
      <p>{{ organizationComplianceDescription(compliance.state, compliance.evidenceFreshness) }}</p>
      <p>
        {{ compliance.characters.length }} attached
        {{ compliance.characters.length === 1 ? 'character' : 'characters' }} evaluated against the
        current organization policy.
      </p>
    </div>
    <dl class="member-compliance__timing">
      <div>
        <dt>Evidence</dt>
        <dd :data-freshness="compliance.evidenceFreshness">
          {{ compliance.evidenceFreshness.toUpperCase() }}
        </dd>
      </div>
      <div>
        <dt>Review deadline</dt>
        <dd>
          <time v-if="compliance.reviewDeadline" :datetime="compliance.reviewDeadline">
            {{ formatOrganizationTimestamp(compliance.reviewDeadline) }} UTC
          </time>
          <span v-else>None</span>
        </dd>
      </div>
      <div v-if="compliance.accessValidUntil">
        <dt>Access retained until</dt>
        <dd>
          <time :datetime="compliance.accessValidUntil">
            {{ formatOrganizationTimestamp(compliance.accessValidUntil) }} UTC
          </time>
        </dd>
      </div>
    </dl>
  </section>

  <p class="compliance-disclosure">{{ compliance.disclosureNotice }}</p>

  <section
    v-if="compliance.accountReasons.length"
    class="compliance-account-issues"
    aria-labelledby="account-issues-heading"
  >
    <p class="ui-eyebrow">ACCOUNT FINDINGS</p>
    <h2 id="account-issues-heading">Registration issues</h2>
    <ul>
      <li v-for="reason in compliance.accountReasons" :key="reason.code">
        {{ organizationReasonLabel(reason.code) }}
      </li>
    </ul>
  </section>

  <section
    v-if="remediationActions.length"
    class="member-actions"
    aria-labelledby="member-actions-heading"
  >
    <header>
      <p class="ui-eyebrow">REQUIRED ACTIONS</p>
      <h2 id="member-actions-heading">Restore or maintain access</h2>
    </header>
    <ul>
      <li
        v-for="action in remediationActions"
        :key="`${action.characterId ?? 'account'}/${action.type}/${action.path ?? 'pending'}`"
      >
        <div>
          <strong>{{ organizationRemediationLabel(action.type) }}</strong>
          <span>{{ action.characterName ?? 'Account registration' }}</span>
        </div>
        <a
          v-if="organizationRemediationHref(apiBase, action.path)"
          class="ui-action-secondary"
          :href="organizationRemediationHref(apiBase, action.path)!"
        >
          RESOLVE
        </a>
        <span v-else class="member-actions__waiting">PENDING</span>
      </li>
    </ul>
  </section>

  <section class="character-compliance" aria-labelledby="character-compliance-heading">
    <header>
      <p class="ui-eyebrow">DISCLOSED CHARACTERS</p>
      <h2 id="character-compliance-heading">Character registration</h2>
    </header>
    <div class="character-compliance__grid">
      <article
        v-for="character in compliance.characters"
        :key="character.characterId"
        class="character-compliance__card"
      >
        <header>
          <NuxtLink :to="`/characters/${character.characterId}`">
            {{ character.characterName }}
          </NuxtLink>
          <span :data-freshness="character.affiliationFreshness">
            {{ character.affiliationFreshness.toUpperCase() }}
          </span>
        </header>
        <dl>
          <div>
            <dt>Character ID</dt>
            <dd>{{ character.characterId }}</dd>
          </div>
          <div>
            <dt>Affiliation checked</dt>
            <dd>{{ formatOrganizationTimestamp(character.affiliationCheckedAt) }}</dd>
          </div>
          <div>
            <dt>Next check</dt>
            <dd>{{ formatOrganizationTimestamp(character.nextAffiliationCheck) }}</dd>
          </div>
        </dl>
        <ul v-if="character.reasons.length" class="character-compliance__issues">
          <li v-for="reason in character.reasons" :key="`${reason.code}/${reason.requiredScope}`">
            <strong>{{ organizationReasonLabel(reason.code) }}</strong>
            <code v-if="reason.requiredScope">{{ reason.requiredScope }}</code>
          </li>
        </ul>
        <p v-else class="character-compliance__clear">Registration requirements satisfied.</p>
        <div v-if="character.remediationActions.length" class="character-compliance__actions">
          <template
            v-for="action in character.remediationActions"
            :key="`${action.type}/${action.path ?? 'pending'}`"
          >
            <a
              v-if="organizationRemediationHref(apiBase, action.path)"
              class="ui-action-secondary"
              :href="organizationRemediationHref(apiBase, action.path)!"
            >
              {{ organizationRemediationLabel(action.type) }}
            </a>
            <span v-else>{{ organizationRemediationLabel(action.type) }}</span>
          </template>
        </div>
      </article>
    </div>
  </section>
</template>

<style scoped>
.compliance-disclosure,
.compliance-account-issues,
.character-compliance__card {
  border: 1px solid var(--line);
  background: var(--panel);
}

.compliance-disclosure {
  margin: 16px 0 0;
  padding: 14px 16px;
  color: var(--muted);
  font-size: 12px;
  line-height: 1.6;
}

.compliance-account-issues,
.character-compliance {
  margin-top: 22px;
}

.compliance-account-issues {
  padding: 22px;
}

.compliance-account-issues h2,
.character-compliance > header h2 {
  margin: 8px 0 0;
}

.compliance-account-issues ul,
.character-compliance__issues {
  margin: 18px 0 0;
  padding-left: 18px;
}

.character-compliance > header {
  margin-bottom: 14px;
}

.character-compliance > header p {
  margin: 0;
}

.character-compliance__grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 14px;
}

.character-compliance__card {
  padding: 20px;
}

.character-compliance__card > header,
.character-compliance__card dl div {
  display: flex;
  justify-content: space-between;
  gap: 16px;
}

.character-compliance__card > header a {
  color: var(--ink);
  font-size: 17px;
  font-weight: 600;
  text-decoration-color: color-mix(in srgb, var(--ui-primary) 45%, transparent);
  text-underline-offset: 4px;
}

.character-compliance__card > header span,
.character-compliance__card dt,
.character-compliance__card dd,
.character-compliance__actions span {
  font: 11px/1.4 monospace;
  letter-spacing: 0.04em;
}

.character-compliance__card > header [data-freshness='fresh'] {
  color: var(--accent);
}

.character-compliance__card > header [data-freshness='stale'],
.character-compliance__card > header [data-freshness='unavailable'] {
  color: var(--ui-warning);
}

.character-compliance__card dl {
  margin: 20px 0;
  display: grid;
  gap: 9px;
}

.character-compliance__card dt {
  color: var(--ui-text-faint);
  text-transform: uppercase;
}

.character-compliance__card dd {
  margin: 0;
  text-align: right;
}

.character-compliance__issues li + li {
  margin-top: 12px;
}

.character-compliance__issues strong,
.character-compliance__issues code {
  display: block;
}

.character-compliance__issues code {
  margin-top: 5px;
  overflow-wrap: anywhere;
  color: var(--ui-warning);
}

.character-compliance__clear {
  color: var(--muted);
  font-size: 12px;
}

.character-compliance__actions {
  margin-top: 18px;
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}

@media (max-width: 760px) {
  .character-compliance__grid {
    grid-template-columns: 1fr;
  }

  .character-compliance__card > header,
  .character-compliance__card dl div {
    align-items: flex-start;
  }
}
</style>
