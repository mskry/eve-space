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
    esiPersistence: { kind: 'organization-esi' },
    moduleId: 'organization-activity',
    routeId: 'activity-details',
    resource: ['detail', toValue(kind), activityId.value, corporationId.value],
    subject: { kind: 'organization', organizationVersion: identity.organizationVersion.value },
    access: {
      authenticated: identity.authenticated.value,
      moduleEnabled: moduleEnabled.value,
      authorized: identity.organizationAuthorized.value,
    },
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
  }))
  const participation = usePlatformProtectedQuery(() => ({
    esiPersistence: { kind: 'none' },
    moduleId: 'organization-activity',
    routeId: 'activity-participation',
    resource: [
      'participation',
      identity.organizationVersion.value,
      toValue(kind),
      activityId.value,
    ],
    subject: { kind: 'character', characterId: characterId.value },
    access: {
      authenticated: identity.authenticated.value,
      moduleEnabled: moduleEnabled.value && identity.organizationAuthorized.value,
      ownsCharacter: Boolean(selectedCharacter.value),
    },
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
    if (!validActivity.value)
      return {
        status: 'unavailable',
        title: 'Select an activity',
        message: 'Open an activity from your organization overview.',
      }
    if (!identity.authenticated.value || !identity.organizationAuthorized.value)
      return { status: 'authorization-required', title: 'Sign in to view organization activity' }
    const error = detail.error.value
    if (error instanceof ApiQueryError && (error.status === 401 || error.status === 403))
      return {
        status: 'authorization-required',
        title: 'Organization access required',
        message: error.message,
      }
    if (error)
      return {
        status: 'unavailable',
        title: 'Activity unavailable',
        message: error.message,
        retryLabel: 'Retry',
      }
    if (detail.status.value === 'pending') return { status: 'loading', title: 'Loading activity' }
    const resource = activityResource.value
    if (resource?.status === 'stale')
      return {
        status: 'stale',
        title: 'Activity is stale',
        message:
          'Showing the last successful collection. Eligibility and completion are unconfirmed.',
      }
    if (!activity.value)
      return {
        status: 'unavailable',
        title: 'Activity not currently available',
        message:
          'Collection may be incomplete, unavailable, or missing an authorized corporation source.',
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
      return {
        status: 'authorization-required',
        title: selectedCharacter.value
          ? `Authorize ${selectedCharacter.value.name}`
          : 'Character authorization required',
        message:
          resourceMessage ??
          (error instanceof Error
            ? error.message
            : 'This character needs additional authorization to show participation.'),
        action: authorizationUrl.value
          ? { href: authorizationUrl.value, label: 'Authorize character' }
          : null,
      }
    }
    if (error)
      return {
        status: 'unavailable',
        title: 'Participation unavailable',
        message: error.message,
        retryLabel: 'Retry',
      }
    if (participation.status.value === 'pending' && !participation.data.value)
      return { status: 'loading', title: 'Loading participation' }
    if (resource?.status === 'stale')
      return {
        status: 'stale',
        title: 'Participation is stale',
        message: 'Showing the last successful participation collection.',
        retryLabel: 'Retry',
      }
    if (!participation.data.value)
      return {
        status: 'unavailable',
        title: 'Participation unavailable',
        message: 'No current participation collection is available.',
      }
    return { status: 'ready' }
  })
  return {
    identity,
    detail,
    participation,
    selectedCharacter,
    characterId,
    activity,
    activityPresentation,
    activityResource,
    participationState,
    state,
    authorizationUrl,
  }
}
