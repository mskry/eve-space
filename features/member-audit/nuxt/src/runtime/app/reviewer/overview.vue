<script setup lang="ts">
import type { PlatformReviewerPanelProps } from '@eve-space/platform-module-nuxt/runtime/reviewer-panel'
import { readPlatformApiResponse } from '@eve-space/platform-module-nuxt/runtime'
import MemberAuditPanelFrame from './MemberAuditPanelFrame.vue'
import {
  memberAuditReviewerQueryOptions,
  targetLabel,
  withMemberAuditReviewerQueryState,
} from './useMemberAuditReviewerQuery'

const props = defineProps<PlatformReviewerPanelProps>()
const api = usePlatformApi()
const route = useRoute()
const router = useRouter()
const summary = withMemberAuditReviewerQueryState(
  props,
  usePlatformProtectedQuery(() => ({
    ...memberAuditReviewerQueryOptions(props, async ({ signal }) =>
      readPlatformApiResponse(
        await api.api.modules['member-audit'].accounts[':userId'].summary.$get(
          { param: { userId: props.target.userId } },
          { init: { signal } },
        ),
        'Member summary is unavailable.',
      ),
    ),
    esiPersistence: { kind: 'none' },
    moduleId: 'member-audit',
    routeId: 'member-summary',
    subject: { kind: 'organization', organizationVersion: props.organizationVersion },
  })),
)
const selectedCharacterId = computed(() => {
  const value = Array.isArray(route.query.targetCharacterId)
    ? route.query.targetCharacterId[0]
    : route.query.targetCharacterId
  return typeof value === 'string' ? value : ''
})

function selectCharacter(event: Event) {
  const characterId = (event.currentTarget as HTMLSelectElement).value
  void router.push({ query: { ...route.query, targetCharacterId: characterId } })
}
</script>

<template>
  <MemberAuditPanelFrame
    classification="Organization access data"
    description="Current core identity, compliance, access, and per-section collection availability."
    permission="member-audit.summary.read"
    :target="targetLabel(props)"
    title="Member overview"
  >
    <PlatformResourceBoundary
      :state="summary.requestState.value"
      :has-data="Boolean(summary.data.value)"
      @retry="summary.refetch()"
    >
      <template v-if="summary.data.value">
        <dl class="member-audit-overview__summary">
          <div>
            <dt>Main character</dt>
            <dd>{{ summary.data.value.account.mainCharacter?.name ?? 'None disclosed' }}</dd>
          </div>
          <div>
            <dt>Compliance</dt>
            <dd>{{ summary.data.value.compliance.state }}</dd>
          </div>
          <div>
            <dt>Compliance evaluated</dt>
            <dd>{{ summary.data.value.compliance.evaluatedAt ?? 'Not yet evaluated' }}</dd>
          </div>
          <div>
            <dt>Organization access</dt>
            <dd>{{ summary.data.value.block.blocked ? 'Blocked' : 'Not blocked' }}</dd>
          </div>
        </dl>

        <section aria-labelledby="member-audit-disclosed-characters">
          <h3 id="member-audit-disclosed-characters">Disclosed characters</h3>
          <output v-if="!summary.data.value.characters.length">
            No current disclosed characters are in this managed-member lifecycle.
          </output>
          <ul v-else>
            <li v-for="character in summary.data.value.characters" :key="character.characterId">
              <strong>{{ character.name }}</strong>
              <span>Character {{ character.characterId }}</span>
              <span>{{ character.affiliation.membership }}</span>
            </li>
          </ul>
          <label
            v-if="summary.data.value.characters.length"
            class="member-audit-overview__character-selection"
          >
            Character for evidence panels
            <select :value="selectedCharacterId" @change="selectCharacter">
              <option
                v-for="character in summary.data.value.characters"
                :key="character.characterId"
                :value="String(character.characterId)"
              >
                {{ character.name }} ({{ character.characterId }})
              </option>
            </select>
          </label>
          <p v-if="summary.data.value.characters.length">
            This selection is retained when you open a character evidence panel.
          </p>
        </section>

        <section aria-labelledby="member-audit-evidence-availability">
          <h3 id="member-audit-evidence-availability">Evidence availability</h3>
          <output v-if="!summary.data.value.evidence.length">
            No evidence sections are available for the disclosed characters.
          </output>
          <ul v-else>
            <li v-for="character in summary.data.value.evidence" :key="character.characterId">
              <strong>Character {{ character.characterId }}</strong>
              <ul>
                <li v-for="section in character.sections" :key="section.sectionId">
                  {{ section.sectionId }}:
                  {{
                    section.resources
                      .map((resource) => `${resource.resourceId} ${resource.status}`)
                      .join(', ') || 'no resources'
                  }}
                </li>
              </ul>
            </li>
          </ul>
        </section>
      </template>
    </PlatformResourceBoundary>
  </MemberAuditPanelFrame>
</template>

<style scoped>
.member-audit-overview__summary {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(min(100%, 12rem), 1fr));
  gap: 0.75rem;
  margin: 0;
}

.member-audit-overview__summary div,
section {
  min-width: 0;
  padding: 0.75rem;
  border: 1px solid var(--ui-border);
  background: var(--ui-surface);
}

.member-audit-overview__summary dt {
  color: var(--ui-text-muted);
  font-size: 0.8rem;
}

.member-audit-overview__summary dd {
  margin: 0.25rem 0 0;
  overflow-wrap: anywhere;
}

section ul {
  display: grid;
  gap: 0.5rem;
  padding-inline-start: 1.25rem;
}

section li span {
  display: block;
  color: var(--ui-text-muted);
}

.member-audit-overview__character-selection {
  display: grid;
  gap: 0.5rem;
  margin-top: 0.75rem;
}

.member-audit-overview__character-selection select {
  width: 100%;
  min-width: 0;
  color: var(--ui-text);
  background: var(--ui-surface-solid);
  border: 1px solid var(--ui-border-strong);
}
</style>
