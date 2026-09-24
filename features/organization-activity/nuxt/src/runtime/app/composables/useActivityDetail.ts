import { computed, type MaybeRefOrGetter, toValue } from 'vue'
import {
  ApiQueryError,
  readPlatformApiResponse,
  selectEsiQueryPersistencePresentation,
  usePlatformIdentity,
  type PlatformResourceState,
} from '@eve-space/platform-module-nuxt/runtime'
import { useRoute } from '#imports'

export function useActivityDetail(kind: MaybeRefOrGetter<'project' | 'job' | 'campaign'>) {
  const route = useRoute()
  const api = usePlatformApi()
  const identity = usePlatformIdentity()
  const { enabledModuleIds } = usePlatformModuleRuntime()
  const activityId = computed(() =>
    typeof route.query.activityId === 'string' ? route.query.activityId : '',
  )
  const validActivity = computed(() =>
    /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i.test(activityId.value),
  )
  const characterId = computed(() => Number(route.query.characterId) || 0)
  const selectedCharacter = computed(() =>
    identity.characters.value.find((character) => character.characterId === characterId.value),
  )
  const corporationId = computed(
    () => Number(route.query.corporationId) || selectedCharacter.value?.corporationId || 0,
  )
  const moduleEnabled = computed(
    () => enabledModuleIds.value.has('organization-activity') && validActivity.value,
  )
  const detail = usePlatformProtectedQuery(() => ({
    access: {
      authenticated: identity.authenticated.value,
      authorized: identity.organizationAuthorized.value,
      moduleEnabled: moduleEnabled.value,
    },
    esiPersistence: { kind: 'organization-esi' },
    moduleId: 'organization-activity',
    query: async ({ signal }) =>
      readPlatformApiResponse(
        await api.api.modules['organization-activity'].details[':kind'][':activityId'].$get(
          {
            param: { kind: toValue(kind), activityId: activityId.value },
            query: corporationId.value ? { corporationId: String(corporationId.value) } : {},
          },
          { init: { signal } },
        ),
        'Activity detail is unavailable.',
      ),
    resource: ['detail', toValue(kind), activityId.value, corporationId.value],
    routeId: 'activity-details',
    subject: { kind: 'organization', organizationVersion: identity.organizationVersion.value },
  }))
  const participation = usePlatformProtectedQuery(() => ({
    access: {
      authenticated: identity.authenticated.value,
      moduleEnabled: moduleEnabled.value && identity.organizationAuthorized.value,
      ownsCharacter: Boolean(selectedCharacter.value),
    },
    esiPersistence: { kind: 'none' },
    moduleId: 'organization-activity',
    query: async ({ signal }) =>
      readPlatformApiResponse(
        await api.api.modules['organization-activity'].characters[':characterId'][':kind'][
          ':activityId'
        ].$get(
          {
            param: {
              characterId: String(characterId.value),
              kind: toValue(kind),
              activityId: activityId.value,
            },
          },
          { init: { signal } },
        ),
        'Character participation is unavailable.',
      ),
    resource: [
      'participation',
      identity.organizationVersion.value,
      toValue(kind),
      activityId.value,
    ],
    routeId: 'activity-participation',
    subject: { characterId: characterId.value, kind: 'character' },
  }))
  const activity = computed(
    () => detail.data.value?.activity ?? participation.data.value?.activity ?? null,
  )
  const activityResource = computed(() =>
    detail.data.value?.activity
      ? detail.data.value.resource
      : (participation.data.value?.resource ?? detail.data.value?.resource),
  )
  const activityPresentation = computed(() =>
    detail.data.value?.activity
      ? detail.persistencePresentation.value
      : selectEsiQueryPersistencePresentation([
          participation.persistencePresentation.value,
          detail.persistencePresentation.value,
        ]),
  )
  const authorizationUrl = computed(() =>
    selectedCharacter.value
      ? api.auth.eve.reauthorize[':characterId']
          .$url({
            param: { characterId: String(characterId.value) },
            query: { returnTo: route.fullPath },
          })
          .toString()
      : null,
  )
  const state = computed<PlatformResourceState>(() => {
    if (!validActivity.value) {
      return {
        message: 'Open an activity from your organization overview.',
        status: 'unavailable',
        title: 'Select an activity',
      }
    }
    if (!identity.authenticated.value || !identity.organizationAuthorized.value) {
      return { status: 'authorization-required', title: 'Sign in to view organization activity' }
    }
    const error = detail.error.value
    if (error instanceof ApiQueryError && (error.status === 401 || error.status === 403)) {
      return {
        message: error.message,
        status: 'authorization-required',
        title: 'Organization access required',
      }
    }
    if (error) {
      return {
        message: error.message,
        retryLabel: 'Retry',
        status: 'unavailable',
        title: 'Activity unavailable',
      }
    }
    if (detail.status.value === 'pending') {
      return { status: 'loading', title: 'Loading activity' }
    }
    const resource = activityResource.value
    if (resource?.status === 'stale') {
      return {
        message:
          'Showing the last successful collection. Eligibility and completion are unconfirmed.',
        status: 'stale',
        title: 'Activity is stale',
      }
    }
    if (!activity.value) {
      return {
        message:
          'Collection may be incomplete, unavailable, or missing an authorized corporation source.',
        status: 'unavailable',
        title: 'Activity not currently available',
      }
    }
    return { status: 'ready' }
  })
  const participationState = computed<PlatformResourceState>(() => {
    const error = participation.error.value
    const resource = participation.data.value?.resource
    const resourceMessage =
      resource?.status === 'authorization-required' &&
      'message' in resource &&
      typeof resource.message === 'string'
        ? resource.message
        : undefined
    if (
      resource?.status === 'authorization-required' ||
      (error instanceof ApiQueryError && (error.status === 401 || error.status === 403))
    ) {
      return participationAuthorizationState(error, resourceMessage)
    }
    if (error) {
      return {
        message: error.message,
        retryLabel: 'Retry',
        status: 'unavailable',
        title: 'Participation unavailable',
      }
    }
    if (participation.status.value === 'pending' && !participation.data.value) {
      return { status: 'loading', title: 'Loading participation' }
    }
    if (resource?.status === 'stale') {
      return {
        message: 'Showing the last successful participation collection.',
        retryLabel: 'Retry',
        status: 'stale',
        title: 'Participation is stale',
      }
    }
    if (!participation.data.value) {
      return {
        message: 'No current participation collection is available.',
        status: 'unavailable',
        title: 'Participation unavailable',
      }
    }
    return { status: 'ready' }
  })
  function participationAuthorizationState(
    error: unknown,
    resourceMessage?: string,
  ): PlatformResourceState {
    return {
      action: authorizationUrl.value
        ? { href: authorizationUrl.value, label: 'Authorize character' }
        : null,
      message:
        resourceMessage ??
        (error instanceof Error
          ? error.message
          : 'This character needs additional authorization to show participation.'),
      status: 'authorization-required',
      title: selectedCharacter.value
        ? `Authorize ${selectedCharacter.value.name}`
        : 'Character authorization required',
    }
  }
  return {
    activity,
    activityPresentation,
    activityResource,
    authorizationUrl,
    characterId,
    detail,
    identity,
    participation,
    participationState,
    selectedCharacter,
    state,
  }
}
