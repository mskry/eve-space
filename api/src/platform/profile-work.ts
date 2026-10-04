import type {
  PlatformInstalledResourceDescriptor,
  PlatformProfileCollectionResourceImplementation,
} from '@eve-space/platform-module-contract/resources'
import { z } from 'zod'
import {
  getEsiOperationAuthorization,
  assertPlatformEsiOperation,
} from '../esi-gateway/catalog-interface.js'
import {
  executeUntypedPlatformEsiOperation,
  type PlatformUntypedEsiExecutionRequest,
} from '../esi-gateway/platform-execution.js'
import {
  assertPlatformResourceRefreshSucceeded,
  classifyPlatformResourceFailure,
} from './resource-failures.js'
import type { PlatformCollectionStateIdentity } from './collection-state.js'
import { createPlatformResourceReadCapabilities } from './module-route-capabilities.js'
import { createPlatformResourceMaintenancePersistence } from './module-persistence-capabilities.js'
import { guardInstalledResourceExecution } from './resource-execution-guard.js'
import { findInstalledResource } from './resource-identity.js'
import { toPlatformResourceSubject } from './resource-subject.js'
import { platformResources } from './resources.js'

const maximumRequests = 512
const profileIdentitySchema = z.strictObject({
  profileId: z.uuid(),
  revision: z.int().positive(),
  dueAt: z.iso.datetime({ offset: true }),
  localWorkPending: z.boolean().optional(),
})

export interface PlannedProfileWork {
  readonly resourceIdentity: PlatformCollectionStateIdentity
  readonly profileId: string
  readonly revision: number
  readonly dueAt: string
  readonly requestedTypeId?: number
  readonly localWorkPending?: boolean
}

const resolveProfileResource = (
  identity: PlatformCollectionStateIdentity,
  resources: readonly PlatformInstalledResourceDescriptor[],
) => {
  const resource = findInstalledResource(identity, resources)
  // SAFETY: The installed declaration is validated at startup; its mode is checked before profile methods run.
  const implementation = resource?.implementation as
    | PlatformProfileCollectionResourceImplementation
    | undefined
  if (
    resource?.profileKeyed !== true ||
    resource.subjectKind !== 'deployment' ||
    implementation?.mode !== 'profile-collection'
  )
    return null
  return { resource, implementation }
}

export const planInstalledProfileWork = async (
  identity: PlatformCollectionStateIdentity,
  now: string,
  limit: number,
  options: {
    readonly resources?: readonly PlatformInstalledResourceDescriptor[]
    readonly signal?: AbortSignal
  } = {},
): Promise<readonly PlannedProfileWork[]> => {
  const resolved = resolveProfileResource(identity, options.resources ?? platformResources)
  if (!resolved || limit <= 0) return []
  const guard = await guardInstalledResourceExecution(identity, {
    resources: [resolved.resource],
    signal: options.signal,
  })
  if (guard.outcome !== 'ready') return []
  const subject = guard.subject
  if (subject?.kind !== 'deployment') return []
  // SAFETY: This capability factory grants only the persistence and core products declared by the validated resource.
  const candidates = await resolved.implementation.plan({
    now,
    limit: Math.min(limit, 16),
    subject,
    capabilities: createPlatformResourceReadCapabilities(
      resolved.resource,
      options.signal,
    ) as never,
    signal: options.signal,
  })
  if (candidates.length > Math.min(limit, 16)) {
    throw new Error('Profile work planner exceeded its candidate bound')
  }
  const seen = new Set<string>()
  return candidates.map((candidate) => {
    const parsed = profileIdentitySchema.parse(candidate)
    if (Date.parse(parsed.dueAt) > Date.parse(now)) {
      throw new Error('Profile work planner returned a future identity')
    }
    if (seen.has(parsed.profileId)) throw new Error('Profile work planner repeated an identity')
    seen.add(parsed.profileId)
    const planned = {
      resourceIdentity: identity,
      profileId: parsed.profileId,
      revision: parsed.revision,
      dueAt: parsed.dueAt,
    }
    if (parsed.localWorkPending !== undefined)
      return Object.assign(planned, { localWorkPending: parsed.localWorkPending })
    return planned
  })
}

export const executeInstalledProfileWork = async (
  work: PlannedProfileWork,
  signal: AbortSignal,
  options: {
    readonly resources?: readonly PlatformInstalledResourceDescriptor[]
  } = {},
): Promise<'completed' | 'obsolete'> => {
  signal.throwIfAborted()
  const resources = options.resources ?? platformResources
  const resolved = resolveProfileResource(work.resourceIdentity, resources)
  if (!resolved) return 'obsolete'
  const ready = async () => {
    const guard = await guardInstalledResourceExecution(work.resourceIdentity, {
      resources: [resolved.resource],
      signal,
    })
    return guard.outcome === 'ready' && guard.subject?.kind === 'deployment'
  }
  if (!(await ready())) return 'obsolete'
  const subject = toPlatformResourceSubject(work.resourceIdentity)
  if (subject?.kind !== 'deployment') return 'obsolete'
  const reads = createPlatformResourceReadCapabilities(resolved.resource, signal)
  const writes = createPlatformResourceMaintenancePersistence(
    resolved.resource.moduleId,
    resolved.resource.resourceId,
    signal,
  )
  const allowed = new Set([
    resolved.resource.operationId,
    ...(resolved.resource.dependentOperationIds ?? []),
  ])
  let requests = 0
  const operations = Object.fromEntries(
    [...allowed].map((operationId) => {
      assertPlatformEsiOperation(operationId)
      if (getEsiOperationAuthorization(operationId).kind !== 'public') {
        throw new Error('Profile work requires public ESI operations')
      }
      return [
        operationId,
        async (inputs: PlatformUntypedEsiExecutionRequest['inputs']) => {
          signal.throwIfAborted()
          if (++requests > maximumRequests)
            throw new RangeError('Profile work request budget exceeded')
          const result = await executeUntypedPlatformEsiOperation({
            operation: operationId,
            inputs,
            authorization: { kind: 'public' },
            signal,
          })
          assertPlatformResourceRefreshSucceeded(result)
          return result
        },
      ]
    }),
  )
  try {
    // SAFETY: The installed declaration fixes operation IDs and capabilities; the gateway validates each dynamic request.
    return await resolved.implementation.execute({
      profileId: work.profileId,
      expectedRevision: work.revision,
      requestedTypeId: work.requestedTypeId,
      subject,
      capabilities: {
        ...reads,
        persistence: { ...reads.persistence, ...writes },
      } as never,
      operations: operations as never,
      requestBudget: maximumRequests,
      assertCurrent: ready,
      classifyFailure: (error) => {
        const failure = classifyPlatformResourceFailure(error)
        return {
          failureClass:
            failure.failureClass === 'authorization-required' ? 'unknown' : failure.failureClass,
          retryAt: failure.nextEligibleAt?.toISOString() ?? null,
        }
      },
      signal,
    })
  } catch (error) {
    signal.throwIfAborted()
    const failure = classifyPlatformResourceFailure(error)
    const failureClass =
      failure.failureClass === 'authorization-required' ? 'unknown' : failure.failureClass
    // SAFETY: The failure hook receives only the persistence declared by the validated resource.
    await resolved.implementation.onFailure({
      profileId: work.profileId,
      expectedRevision: work.revision,
      requestedTypeId: work.requestedTypeId,
      failureClass,
      retryAt: failure.nextEligibleAt?.toISOString() ?? null,
      capabilities: { logger: reads.logger, persistence: writes } as never,
    })
    throw error
  }
}
