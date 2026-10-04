import type {
  PlatformInstalledInventoryConsumer,
  PlatformInstalledInventoryProvider,
  PlatformInventoryRead,
  PlatformInventoryView,
} from '@eve-space/platform-module-contract/inventory'
import type {
  PlatformInstalledGraphQLContribution,
  PlatformGraphQLReadDeclaration,
  PlatformGraphQLReadInput,
} from '@eve-space/platform-module-contract/graphql'
import { z } from 'zod'
import type { SessionAccount } from '../auth/session-store.js'
import { immediateReadWork, type ReadAdmissionWork } from '../auth/read-work.js'
import { assertReadAdmission } from '../auth/read-policy.js'
import { fingerprintReadValue } from '../read-value.js'
import {
  installedInventoryConsumers,
  installedInventoryProviders,
} from '../generated/platform/installed-module-inventory-providers.js'
import { admitInventory, createInventoryReadGuard } from './inventory-admission.js'
import { decodeInventoryCursor, normalizeInventoryRead } from './inventory-cursor.js'
import {
  loadPersonalInventoryReduction,
  personalInventoryPage,
  assertPersonalReductionCurrent,
} from './inventory-personal-read.js'
import { readCorporationInventoryPage } from './inventory-corporation-read.js'
import { createPlatformModuleReadPersistence } from './module-persistence-capabilities.js'
import { guardReadCapabilities } from './guarded-read-capabilities.js'

const consumers: readonly PlatformInstalledInventoryConsumer[] = installedInventoryConsumers
const providers: readonly PlatformInstalledInventoryProvider[] = installedInventoryProviders
const selectionSchema = z
  .array(
    z
      .string()
      .regex(/^[1-9]\d{0,15}$/)
      .transform(Number)
      .refine(Number.isSafeInteger),
  )
  .max(20)
  .nullish()

interface InventoryRequestWork extends ReadAdmissionWork {
  readonly signal: AbortSignal
  reuse<Result>(
    identity: string,
    check: () => Promise<void>,
    load: (signal: AbortSignal) => Promise<Result>,
  ): Promise<Result>
}

const selection = (
  value: PlatformGraphQLReadInput['args'][string],
): readonly number[] | undefined => {
  const parsed = selectionSchema.safeParse(value)
  if (parsed.success) return parsed.data ?? undefined
  const code = parsed.error.issues.some((issue) => issue.code === 'too_big')
    ? 'INVENTORY_LIMIT'
    : 'BAD_USER_INPUT'
  throw Object.assign(new Error('Invalid inventory selection'), { code })
}

const declaredConsumer = (moduleId: string, read: PlatformGraphQLReadDeclaration) => {
  const installed = consumers.find(
    (item) => item.moduleId === moduleId && item.declaration.id === read.inventoryConsumerId,
  )
  if (!installed) throw new Error('Missing installed inventory consumer')
  return installed.declaration
}

const providerFor = (consumer: ReturnType<typeof declaredConsumer>) => {
  if (consumer.scope !== 'corporation') throw new Error('Invalid inventory provider scope')
  const provider = providers.find(
    (item) =>
      item.moduleId === consumer.provider.moduleId && item.id === consumer.provider.providerId,
  )
  if (!provider)
    throw Object.assign(new Error('Inventory scope is unavailable.'), {
      code: 'INVENTORY_SCOPE_DENIED',
    })
  return provider
}

export const createInstalledInventoryCapabilities = async (
  contribution: Pick<PlatformInstalledGraphQLContribution, 'moduleId' | 'publisherPackage'>,
  read: PlatformGraphQLReadDeclaration,
  args: PlatformGraphQLReadInput['args'],
  liveSession: (work?: ReadAdmissionWork) => Promise<SessionAccount | null>,
  work: InventoryRequestWork,
) => {
  const consumer = declaredConsumer(contribution.moduleId, read)
  const session = await liveSession()
  const request =
    consumer.scope === 'personal'
      ? {
          scope: 'personal' as const,
          characterIds: selection(args[read.subjectArgument ?? 'characterIds']),
        }
      : {
          scope: 'corporation' as const,
          corporationId: selection([args[read.subjectArgument ?? 'corporationId']])![0]!,
          declaration: {
            ...read.organization!,
            moduleId: contribution.moduleId,
            publisherPackage: contribution.publisherPackage,
          },
        }
  const admission = await admitInventory(session, request, work)
  if (!admission.admitted) {
    assertReadAdmission(admission)
    throw new Error('Unreachable inventory denial')
  }
  const binding = admission.binding
  const guard = createInventoryReadGuard(binding, liveSession, immediateReadWork, {
    signal: work.signal,
  })
  const sourceWork = {
    signal: work.signal,
    run: <Result>(load: (slot?: ReadAdmissionWork) => Promise<Result>) =>
      work.run(async () => {
        await guard.assertCurrent(immediateReadWork)
        work.signal.throwIfAborted()
        return load(immediateReadWork)
      }),
  }
  let checkSources: (() => void) | undefined
  const assertCurrent = async () => {
    await guard.assertCurrent()
    checkSources?.()
    work.signal.throwIfAborted()
  }
  const execute = async (unvalidated: PlatformInventoryRead): Promise<PlatformInventoryView> => {
    work.signal.throwIfAborted()
    const input = normalizeInventoryRead(unvalidated)
    if (input.first < 1 || input.first > consumer.maximumPageSize || !Number.isInteger(input.first))
      throw Object.assign(new Error('Invalid inventory page size.'), { code: 'BAD_USER_INPUT' })
    const cursor = decodeInventoryCursor(input, binding.fingerprint, binding.scope)
    await guard.assertCurrent()
    let result: PlatformInventoryView
    if (binding.scope === 'personal') {
      const reduction = await work.reuse(
        fingerprintReadValue(['inventory-sources', binding.fingerprint]),
        guard.assertCurrent,
        () => loadPersonalInventoryReduction(binding, sourceWork),
      )
      checkSources = () => assertPersonalReductionCurrent(reduction)
      assertPersonalReductionCurrent(reduction)
      result = personalInventoryPage(binding, reduction, input, cursor)
    } else {
      const provider = providerFor(consumer)
      const persistence = guardReadCapabilities(
        createPlatformModuleReadPersistence(
          {
            moduleId: provider.moduleId,
            contributionId: provider.id,
            grant: 'inventoryProviders',
            operations: provider.persistenceOperations,
          },
          work.signal,
        ),
        guard,
        sourceWork,
      )
      result = await readCorporationInventoryPage(
        binding,
        provider.definition({ persistence, signal: work.signal }),
        input,
        cursor,
      )
      checkSources = () => {
        if (
          binding.evidenceSubjects.some(
            (subject) =>
              subject.collection?.state === 'current' &&
              Date.parse(subject.collection.freshUntil ?? '') <= Date.now(),
          )
        )
          throw Object.assign(new Error('Inventory source expired'), {
            code: 'INVENTORY_RESTART_REQUIRED',
          })
      }
    }
    work.signal.throwIfAborted()
    return guard.release(
      result,
      input.kind === 'holders' ? 'holders' : 'aggregate',
      input.kind === 'holders' ? result.holders.rows.map((row) => row.characterId) : undefined,
    )
  }
  return Object.freeze({
    identity: binding.fingerprint,
    assertCurrent,
    inventory:
      consumer.scope === 'personal'
        ? Object.freeze({ personalInventory: execute })
        : Object.freeze({ corporationInventory: execute }),
  })
}
