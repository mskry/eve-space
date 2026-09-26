import type { QueryCache } from '@pinia/colada'
import { removePlatformQueryScope } from '@eve-space/platform-module-nuxt/runtime'
import { toValue, watch, type MaybeRefOrGetter } from 'vue'
import {
  reacquireOrganizationAdmission,
  readOrganizationReadiness,
  readOrganizationRevision,
  setOrganizationReadiness,
} from '../query-persistence/runtime'
import type { ApiClient } from '../utils/api-client'
import { adminSessionQuery } from './admin'
import type { AuthSession } from './auth'
import { organizationContextQuery, type OrganizationContext } from './organization'
import { ADMIN_QUERY_KEYS, PRIVATE_QUERY_KEYS } from './query-keys'

const matchesCurrentOrganization = (
  context: OrganizationContext,
  version: number | undefined,
  adminOrganization?: { id: number; type: string } | null,
) =>
  (version === undefined || context.organization.organizationVersion === version) &&
  (!adminOrganization ||
    (context.organization.organizationId === adminOrganization.id &&
      context.organization.organizationType === adminOrganization.type))

const reloadOrganizationReadiness = async (
  queryCache: QueryCache,
  apiClient: ApiClient,
  session: AuthSession,
) => {
  if (import.meta.server) {
    return false
  }
  let revision = readOrganizationRevision(queryCache).value
  if (readOrganizationReadiness(queryCache).value === 'clearing') {
    return false
  }
  setOrganizationReadiness(queryCache, 'loading', revision)
  if (!session.authenticated) {
    setOrganizationReadiness(queryCache, 'unavailable', revision)
    return false
  }

  try {
    const admission = await reacquireOrganizationAdmission(queryCache)
    if (!admission) {
      setOrganizationReadiness(queryCache, 'unavailable', revision)
      return false
    }
    if (revision !== readOrganizationRevision(queryCache).value) {
      if (readOrganizationReadiness(queryCache).value !== 'loading') {
        return false
      }
      revision = readOrganizationRevision(queryCache).value
    }

    let adminOrganization = queryCache.getQueryData<{
      authenticated: boolean
      account?: { organization: { id: number; type: string } | null }
    }>(ADMIN_QUERY_KEYS.session)
    if (adminOrganization?.authenticated) {
      adminOrganization = (await queryCache.fetch(queryCache.ensure(adminSessionQuery(apiClient))))
        .data
    }
    if (revision !== readOrganizationRevision(queryCache).value) {
      return false
    }

    const context = await queryCache.fetch(queryCache.ensure(organizationContextQuery(apiClient)))
    if (
      !context.data ||
      !matchesCurrentOrganization(
        context.data,
        admission.organization?.organizationVersion,
        adminOrganization?.account?.organization,
      )
    ) {
      removePlatformQueryScope(queryCache, PRIVATE_QUERY_KEYS.organization())
      setOrganizationReadiness(queryCache, 'unavailable', revision)
      return false
    }
    return setOrganizationReadiness(queryCache, 'ready', revision)
  } catch {
    if (revision === readOrganizationRevision(queryCache).value) {
      removePlatformQueryScope(queryCache, PRIVATE_QUERY_KEYS.organization())
    }
    setOrganizationReadiness(queryCache, 'unavailable', revision)
    return false
  }
}

export const observeOrganizationReadiness = (
  queryCache: QueryCache,
  apiClient: ApiClient,
  session: MaybeRefOrGetter<AuthSession>,
  verified: MaybeRefOrGetter<boolean>,
) => {
  const readiness = readOrganizationReadiness(queryCache)
  const revision = readOrganizationRevision(queryCache)
  let running = false
  let pending = false
  let activeRevision = revision.value
  let activeAuthenticated = toValue(session).authenticated

  const flushReloads = async (): Promise<void> => {
    pending = false
    activeRevision = revision.value
    activeAuthenticated = toValue(session).authenticated
    await reloadOrganizationReadiness(queryCache, apiClient, toValue(session))
    if (pending && toValue(verified) && readiness.value === 'loading') {
      await flushReloads()
    }
  }

  const scheduleReload = async () => {
    if (running) {
      if (
        activeRevision !== revision.value ||
        activeAuthenticated !== toValue(session).authenticated
      ) {
        pending = true
      }
      return
    }
    running = true
    try {
      await flushReloads()
    } finally {
      running = false
    }
  }

  return watch(
    () =>
      [readiness.value, revision.value, toValue(verified), toValue(session).authenticated] as const,
    ([status, , isVerified, authenticated], previous) => {
      if (import.meta.server || !isVerified) {
        return
      }
      const newlyAuthenticated = authenticated && previous?.[3] === false
      if (status === 'loading' || (status === 'unavailable' && newlyAuthenticated)) {
        void scheduleReload()
      }
    },
  )
}

export const retryOrganizationReadiness = (queryCache: QueryCache) => {
  const revision = readOrganizationRevision(queryCache).value
  if (readOrganizationReadiness(queryCache).value === 'unavailable') {
    setOrganizationReadiness(queryCache, 'loading', revision)
  }
}
