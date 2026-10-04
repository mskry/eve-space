import type {
  PlatformGraphQLReadCapabilities,
  PlatformInstalledGraphQLContribution,
  PlatformGraphQLReadInput,
} from '@eve-space/platform-module-contract/graphql'
import type { SessionAccount } from '../auth/session-store.js'
import type { ReadAdmissionWork } from '../auth/read-work.js'
import { assertReadAdmission } from '../auth/read-policy.js'
import { admitModuleRead, createModuleReadGuard } from '../platform/read-admission.js'
import { createPlatformModuleReadCapabilities } from '../platform/module-route-capabilities.js'
import { createInstalledInventoryCapabilities } from '../platform/inventory-capabilities.js'
import { z } from 'zod'
import { fingerprintReadValue } from '../read-value.js'
import { GraphQLRequestState } from './request-state.js'
import type { GraphQLCachePolicy } from './cache-policy.js'

type BoundRead = ReturnType<typeof createInstalledGraphQLRead>
type AdmissionCheck = () => Promise<void>

const inventoryFrame = z.object({
  groups: z.unknown(),
  holders: z.unknown(),
  coverage: z.unknown(),
})
const objectIdentity = z.instanceof(Object)

const bindInventoryProjections = (
  result: PlatformGraphQLReadInput['parent'],
  admitted: AdmissionCheck,
  parents: WeakMap<object, AdmissionCheck>,
) => {
  const frame = inventoryFrame.parse(result)
  for (const value of [result, frame.groups, frame.holders, frame.coverage]) {
    const identity = objectIdentity.safeParse(value)
    if (identity.success) parents.set(identity.data, admitted)
  }
}

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
  if (read.strategy === 'personal-inventory' || read.strategy === 'reviewer-corporation-inventory')
    return Object.freeze({ resolve, read, contribution, policy: null })
  return Object.freeze({
    resolve,
    read,
    contribution,
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
  const inventoryParents = new WeakMap<object, AdmissionCheck>()
  return Object.freeze({
    signal: state.signal,
    execute: async (bound: BoundRead, parent: unknown, args: Readonly<Record<string, unknown>>) => {
      state.signal.throwIfAborted()
      const { read, policy, resolve } = bound
      if (!policy) {
        cache.noStore()
        const admitted = await createInstalledInventoryCapabilities(
          bound.contribution,
          read,
          args,
          liveSession,
          state,
        )
        await admitted.assertCurrent()
        const result = await state.wait(
          Promise.resolve(
            resolve({
              parent,
              args,
              subject: null,
              capabilities: Object.freeze({
                inventory: admitted.inventory,
                signal: state.signal,
                cache,
                persistence: {},
                coreData: {},
              }),
            }),
          ),
        )
        await admitted.assertCurrent()
        state.signal.throwIfAborted()
        const value = objectIdentity.parse(result)
        bindInventoryProjections(value, admitted.assertCurrent, inventoryParents)
        return result
      }
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
      const parentIdentity = objectIdentity.safeParse(parent)
      const inventoryAdmission = parentIdentity.success
        ? inventoryParents.get(parentIdentity.data)
        : undefined
      const assertCurrent = async () => {
        await guard.assertCurrent()
        await inventoryAdmission?.()
      }
      if (!bindings.has(bound)) bindings.set(bound, bindings.size)
      const identity = fingerprintReadValue([bindings.get(bound), guard.identity, args, parent])
      return state.reuse(identity, assertCurrent, async (readSignal) => {
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
