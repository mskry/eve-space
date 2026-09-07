<script setup lang="ts">
import { computed } from 'vue'
import { useRouter, useRoute, useHead } from '#imports'
import { useActivityDetail } from '../composables/useActivityDetail'

const props = defineProps<{ kind: 'project' | 'job' | 'campaign'; title: string }>()
const router = useRouter()
const route = useRoute()
const {
  identity,
  detail,
  participation,
  selectedCharacter,
  characterId,
  activity,
  activityResource,
  state,
  authorizationUrl,
} = useActivityDetail(() => props.kind)
const resource = computed(() => participation.data.value?.resource)
const authorizationRequired = computed(() => resource.value?.status === 'authorization-required')
const participationUnavailable = computed(
  () => participation.error.value || resource.value?.status !== 'current',
)
useHead(() => ({ title: activity.value?.title ?? props.title }))

function selectCharacter(event: Event) {
  const value = (event.target as HTMLSelectElement).value
  void router.replace({ query: { ...route.query, characterId: value || undefined } })
}
</script>

<template>
  <section class="organization-activity-detail">
    <h1>{{ activity?.title ?? title }}</h1>
    <PlatformResourceBoundary
      :state="state"
      :has-data="Boolean(activity)"
      @retry="detail.refresh()"
    >
      <p v-if="activity?.description">{{ activity.description }}</p>
      <dl v-if="activity">
        <dt>State</dt>
        <dd>{{ activity.state }}</dd>
        <dt v-if="activity.objective">Objective</dt>
        <dd v-if="activity.objective">{{ activity.objective }}</dd>
        <dt v-if="activity.progress">Progress</dt>
        <dd v-if="activity.progress">
          {{ activity.progress.current }} / {{ activity.progress.desired }}
        </dd>
        <dt v-if="activity.reward">Remaining reward</dt>
        <dd v-if="activity.reward">{{ activity.reward.remaining }} ISK</dd>
        <dt v-if="activity.deadline">Deadline</dt>
        <dd v-if="activity.deadline">{{ activity.deadline }}</dd>
        <dt>Last collected</dt>
        <dd>{{ activityResource?.validatedAt ?? 'Not yet collected' }}</dd>
      </dl>
      <ul v-if="detail.data.value?.objectives.length">
        <li v-for="objective in detail.data.value.objectives" :key="objective.id">
          {{ objective.title }} — {{ objective.state }}
        </li>
      </ul>
    </PlatformResourceBoundary>
    <label for="activity-character">Participation character</label>
    <select id="activity-character" :value="characterId || ''" @change="selectCharacter">
      <option value="">Select an owned character</option>
      <option
        v-for="character in identity.characters.value"
        :key="character.characterId"
        :value="character.characterId"
      >
        {{ character.name }}
      </option>
    </select>
    <template v-if="selectedCharacter">
      <PlatformAuthorizationRequired
        v-if="authorizationRequired"
        :title="`Authorize ${selectedCharacter.name}`"
        :authorize-url="authorizationUrl"
        message="This character needs additional authorization to show participation."
      />
      <p v-else-if="participationUnavailable" role="status">
        Participation is unavailable or stale for {{ selectedCharacter.name }}.
      </p>
      <p v-else-if="!participation.data.value?.participation.length" role="status">
        No participation is recorded for {{ selectedCharacter.name }}.
      </p>
      <ul v-else>
        <li v-for="entry in participation.data.value?.participation" :key="entry.activityId">
          {{ selectedCharacter.name }} contributed {{ entry.contributed ?? 0 }}.
          {{ entry.committed ? 'Participating.' : 'Not currently participating.' }}
        </li>
      </ul>
    </template>
    <p>Participation actions take place in EVE Online.</p>
  </section>
</template>

<style scoped>
.organization-activity-detail {
  max-width: 60rem;
  margin-inline: auto;
  padding: 1rem;
  color: var(--ui-text);
}
.organization-activity-detail dl {
  display: grid;
  grid-template-columns: minmax(6rem, 1fr) minmax(0, 3fr);
  gap: 0.5rem 1rem;
  overflow-wrap: anywhere;
}
.organization-activity-detail dd {
  margin: 0;
}
.organization-activity-detail select {
  display: block;
  max-width: 100%;
  min-height: 2.75rem;
  margin-block: 0.5rem 1rem;
  color: var(--ui-text);
  background: var(--ui-surface);
  border: 1px solid var(--ui-border);
}
.organization-activity-detail select:focus-visible {
  outline: 2px solid var(--ui-primary);
  outline-offset: 2px;
}
</style>
