import type {
  PlatformGraphQLReadCapabilities,
  PlatformInstalledGraphQLContribution,
} from '@eve-space/platform-module-contract/graphql'
import type { SessionAccount } from '../auth/session-store.js'
import type { ReadAdmissionWork } from '../auth/read-work.js'
import { assertReadAdmission } from '../auth/read-policy.js'
import { admitModuleRead, createModuleReadGuard } from '../platform/read-admission.js'
import { createPlatformModuleReadCapabilities } from '../platform/module-route-capabilities.js'
import { fingerprintReadValue } from '../read-value.js'
import { GraphQLRequestState } from './request-state.js'
import type { GraphQLCachePolicy } from './cache-policy.js'

type BoundRead = ReturnType<typeof createInstalledGraphQLRead>

export interface GraphQLReadContext {
  readonly execution: ReturnType<typeof createGraphQLReadExecution>
}

const ownedSubject = (value: unknown): number => {
  if (
    typeof value !== 'string' ||
    !/^[1-9]\d{0,15}$/.test(value) ||
    !Number.isSafeInteger(Number(value))
  )
    throw new TypeError('Invalid exact GraphQL character identity')
  return Number(value)
}

export const createInstalledGraphQLRead = (
  contribution: PlatformInstalledGraphQLContribution,
  field: string,
) => {
  const { moduleId, id: contributionId } = contribution
  const read = contribution.reads.find((item) => item.field === field)
  const resolve = contribution.definition.reads[field]
  if (!read || !resolve) throw new Error('Missing installed GraphQL read binding')
  return Object.freeze({
    resolve,
    read,
    policy: {
      moduleId,
      contributionId,
      readId: read.id,
      strategy: read.strategy,
      sectionId: read.sectionId,
      requiredScope: read.requiredScope,
      organization: read.organization
        ? { ...read.organization, moduleId, publisherPackage: contribution.publisherPackage }
        : undefined,
    },
  })
}

export const createGraphQLReadExecution = ({
  signal,
  liveSession,
  cache,
  state = new GraphQLRequestState(signal),
  cachePolicy,
}: {
  signal: AbortSignal
  liveSession: (work?: ReadAdmissionWork) => Promise<SessionAccount | null>
  cache: PlatformGraphQLReadCapabilities['cache']
  state?: GraphQLRequestState
  cachePolicy?: GraphQLCachePolicy
}) => {
  const bindings = new Map<BoundRead, number>()
  return Object.freeze({
    signal: state.signal,
    execute: async (bound: BoundRead, parent: unknown, args: Readonly<Record<string, unknown>>) => {
      state.signal.throwIfAborted()
      const { read, policy, resolve } = bound
      const characterId = read.subjectArgument
        ? ownedSubject(args[read.subjectArgument])
        : undefined
      const admission = await admitModuleRead(
        policy,
        read.strategy === 'public' ? null : await liveSession(),
        characterId,
      )
      if (!admission.admitted) assertReadAdmission(admission)
      if (!admission.admitted) throw new Error('Unreachable denied GraphQL read')
      const guard = createModuleReadGuard(admission.binding, liveSession)
      if (!bindings.has(bound)) bindings.set(bound, bindings.size)
      const identity = fingerprintReadValue([bindings.get(bound), guard.identity, args, parent])
      return state.reuse(identity, guard.assertCurrent, async (readSignal) => {
        const verdict = cachePolicy?.field(
          read.persistenceOperations.length + read.coreDataProducts.length > 0,
        )
        const capabilities = Object.freeze({
          ...createPlatformModuleReadCapabilities(
            {
              moduleId: policy.moduleId,
              contributionId: `${policy.contributionId}/${read.id}`,
              grant: 'graphqlReads',
              operations: read.persistenceOperations,
            },
            read.coreDataProducts,
            guard,
            readSignal,
            state,
          ),
          signal: readSignal,
          cache: verdict?.cache ?? cache,
        })
        const result = await resolve({
          parent,
          args,
          capabilities,
          subject: characterId === undefined ? null : Object.freeze({ characterId }),
        })
        verdict?.finish()
        return result
      })
    },
  })
}
