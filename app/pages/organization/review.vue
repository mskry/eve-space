<script setup lang="ts">
import { ApiQueryError } from '../../utils/query-error'
import { reviewerContributionIdentity } from '../../utils/organization-review'

definePageMeta({ platformAudience: 'authenticated', title: 'Organization review' })

useHead({
  meta: [{ name: 'description', content: 'Authorized organization member review workspace.' }],
  title: 'Organization review // EVE Space',
})

const workspace = useOrganizationReviewWorkspace()
const entryError = computed(() => workspace.entryError.value)
const entryErrorStatus = computed(() =>
  entryError.value instanceof ApiQueryError ? entryError.value.status : undefined,
)
const entryErrorCode = computed(() =>
  entryError.value instanceof ApiQueryError ? entryError.value.code : undefined,
)
const selectedContributionIdentity = computed(
  () =>
    workspace.selectedContribution.value &&
    reviewerContributionIdentity(workspace.selectedContribution.value),
)
</script>

<template>
  <div class="organization-review-page">
    <header class="organization-review-page__heading">
      <div>
        <p class="ui-eyebrow">ORGANIZATION OPERATIONS</p>
        <h1>Organization review</h1>
      </div>
      <p>Select a managed member, then open only the review capabilities granted to you.</p>
    </header>

    <UiStatePanel v-if="workspace.authLoading.value" compact role="status">
      <p>Verifying reviewer identity...</p>
    </UiStatePanel>
    <UiStatePanel
      v-else-if="
        workspace.entryQuery.asyncStatus.value === 'loading' && !workspace.entryQuery.data.value
      "
      compact
      role="status"
    >
      <p>Preparing the organization review workspace...</p>
    </UiStatePanel>
    <UiStatePanel
      v-else-if="entryErrorStatus === 404"
      code="WORKSPACE UNAVAILABLE"
      title="Organization review is not available"
      role="status"
    >
      <p>No installed and enabled reviewer contributions are available.</p>
    </UiStatePanel>
    <UiStatePanel
      v-else-if="entryErrorStatus === 403"
      :code="entryErrorCode ?? 'REVIEW ACCESS DENIED'"
      title="Organization review access is blocked"
      role="alert"
    >
      <p>{{ entryError?.message }}</p>
    </UiStatePanel>
    <UiStatePanel
      v-else-if="entryError"
      code="WORKSPACE TEMPORARILY UNAVAILABLE"
      title="Organization review could not be loaded"
      role="alert"
    >
      <p>No private panel was loaded. Retry when the service is available.</p>
      <button class="ui-action-secondary" type="button" @click="workspace.retryEntry">
        RETRY WORKSPACE
      </button>
    </UiStatePanel>
    <UiStatePanel
      v-else-if="workspace.runtimeQuery.error.value"
      code="MODULE STATE UNAVAILABLE"
      title="Review panel availability could not be verified"
      role="alert"
    >
      <p>No private panel was loaded without a current module enablement verdict.</p>
      <button class="ui-action-secondary" type="button" @click="workspace.retryEntry">
        RETRY WORKSPACE
      </button>
    </UiStatePanel>
    <UiStatePanel
      v-else-if="
        workspace.entryQuery.data.value && workspace.availableContributions.value.length === 0
      "
      code="NO COMPATIBLE PANELS"
      title="No authorized review panel is available"
      role="status"
    >
      <p>Installed panel metadata does not match a currently enabled authorized contribution.</p>
    </UiStatePanel>

    <template v-else-if="workspace.entryQuery.data.value">
      <OrganizationReviewDirectory
        v-model:audit-state="workspace.auditState.value"
        v-model:blocked="workspace.blocked.value"
        v-model:compliance-state="workspace.complianceState.value"
        v-model:corporation-text="workspace.corporationText.value"
        v-model:group-id="workspace.groupId.value"
        v-model:limit="workspace.limit.value"
        v-model:search-text="workspace.searchText.value"
        :direction="workspace.direction.value"
        :group-facets="workspace.groupFacets.value"
        :has-next-page="Boolean(workspace.directoryQuery.data.value?.nextCursor)"
        :has-previous-page="workspace.cursorHistory.value.length > 0"
        :loading="workspace.directoryQuery.asyncStatus.value === 'loading'"
        :members="workspace.members.value"
        :page="workspace.cursorHistory.value.length + 1"
        :selected-user-id="workspace.selectedMember.value?.account.userId"
        :sort="workspace.sort.value"
        @change-sort="workspace.changeDirectorySort"
        @next="workspace.nextDirectoryPage"
        @previous="workspace.previousDirectoryPage"
        @search="workspace.submitSearch"
        @select="workspace.selectMember"
      />

      <UiStatePanel
        v-if="workspace.directoryQuery.status.value === 'error'"
        code="DIRECTORY UNAVAILABLE"
        title="Managed members could not be loaded"
        role="alert"
      >
        <button class="ui-action-secondary" type="button" @click="workspace.retryDirectory">
          RETRY DIRECTORY
        </button>
      </UiStatePanel>

      <OrganizationReviewContributionNavigation
        v-if="workspace.selectedMember.value"
        :model-value="selectedContributionIdentity"
        :contributions="workspace.availableContributions.value"
        @update:model-value="workspace.selectContribution"
      >
        <OrganizationReviewPanelHost
          v-if="workspace.selectedContribution.value && workspace.selectedTarget.value"
          :contribution="workspace.selectedContribution.value"
          :focus-request="workspace.panelFocusRequest.value"
          :organization-version="workspace.organizationVersion.value"
          :query-access="workspace.queryAccess.value"
          :target="workspace.selectedTarget.value"
        />
      </OrganizationReviewContributionNavigation>
      <UiStatePanel v-else compact code="SELECT A MEMBER" title="Choose a managed member">
        <p>Private panels remain unloaded until you select a member and a review capability.</p>
      </UiStatePanel>
    </template>
  </div>
</template>

<style scoped>
.organization-review-page {
  display: grid;
  width: 100%;
  min-width: 0;
  max-width: 100%;
  gap: clamp(1rem, 2vw, 1.5rem);
  overflow-x: clip;
}

.organization-review-page__heading {
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(16rem, 0.8fr);
  gap: 1rem;
  align-items: end;
}

.organization-review-page__heading h1 {
  margin: 0.25rem 0 0;
}

.organization-review-page__heading > p {
  max-width: 42rem;
  margin: 0;
  color: var(--ui-text-muted);
}

@media (max-width: 44rem) {
  .organization-review-page__heading {
    grid-template-columns: minmax(0, 1fr);
  }
}

@media (prefers-reduced-motion: reduce) {
  .organization-review-page {
    scroll-behavior: auto;
  }
}
</style>
