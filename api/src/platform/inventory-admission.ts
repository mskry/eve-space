import type {
  PlatformAdmittedCorporationInventory,
  PlatformAdmittedPersonalInventory,
  PlatformInstalledInventoryProvider,
} from '@eve-space/platform-module-contract/inventory'
import type { PlatformInstalledOrganizationContributionAuthorization } from '@eve-space/platform-module-contract/installed'
import {
  admitPersonalInventory,
  type PersonalInventoryBinding,
} from '../auth/inventory-admission.js'
import { assertReadAdmission, type ReadAdmissionDenial } from '../auth/read-policy.js'
import { immediateReadWork, type ReadAdmissionWork } from '../auth/read-work.js'
import type { SessionAccount } from '../auth/session-store.js'
import { installedInventoryProviders } from '../generated/platform/installed-module-inventory-providers.js'
import { inventoryDenial, inventoryFingerprint } from '../inventory-policy.js'
import {
  admitCorporationInventoryScope,
  type CorporationInventoryScope,
} from '../organization/inventory-admission.js'
import { recordInventoryAccessDecision } from './inventory-access-audit.js'
import { moduleReadEnablementDenial } from './read-enablement.js'
import {
  loadCorporationInventorySourceSubjects,
  type CorporationInventorySubject,
} from './inventory-source-admission.js'

export interface CorporationInventoryBinding extends CorporationInventoryScope {
  readonly scope: 'corporation'
  readonly subjects: readonly CorporationInventorySubject[]
  readonly evidenceSubjects: readonly CorporationInventorySubject[]
  readonly fingerprint: string
}

export type InventoryBinding = PersonalInventoryBinding | CorporationInventoryBinding
export type InventoryAdmission =
  | ReadAdmissionDenial
  | { readonly admitted: true; readonly binding: InventoryBinding }

export type InventoryAdmissionRequest =
  | { readonly scope: 'personal'; readonly characterIds?: readonly number[] }
  | {
      readonly scope: 'corporation'
      readonly corporationId: number
      readonly characterIds?: readonly number[]
      readonly declaration: PlatformInstalledOrganizationContributionAuthorization
    }

const inventoryProviders: readonly PlatformInstalledInventoryProvider[] =
  installedInventoryProviders
const inventoryProviderAvailable = () =>
  inventoryProviders.some(
    (provider) =>
      provider.moduleId === 'member-audit' &&
      provider.sectionId === 'assets' &&
      provider.requiredPermission === 'member-audit.assets.read' &&
      provider.contractVersion === 1,
  )

const admitCorporationInventory = async (
  session: SessionAccount | null,
  request: Extract<InventoryAdmissionRequest, { scope: 'corporation' }>,
  work: ReadAdmissionWork,
): Promise<InventoryAdmission> => {
  const scope = await admitCorporationInventoryScope(
    session,
    request.declaration,
    request.corporationId,
    request.characterIds,
    work,
  )
  if (!scope.admitted) return scope
  if (!inventoryProviderAvailable()) return inventoryDenial('INVENTORY_SCOPE_DENIED')
  const disabled = await work.run(() => moduleReadEnablementDenial('member-audit', 'assets'))
  if (disabled) return disabled
  const subjects = Object.freeze(
    await work.run(() => loadCorporationInventorySourceSubjects(scope.binding)),
  )
  const identity = { ...scope.binding, scope: 'corporation' as const, subjects }
  return {
    admitted: true,
    binding: Object.freeze({
      ...identity,
      evidenceSubjects: Object.freeze(subjects.filter((subject) => subject.evidenceReadable)),
      fingerprint: inventoryFingerprint(identity),
    }),
  }
}

const admitInventoryRequest = async (
  session: SessionAccount | null,
  request: InventoryAdmissionRequest,
  work: ReadAdmissionWork,
): Promise<InventoryAdmission> => {
  const disabled = await work.run(() => moduleReadEnablementDenial('trading'))
  if (disabled) return disabled
  return request.scope === 'personal'
    ? admitPersonalInventory(session, request.characterIds, work)
    : admitCorporationInventory(session, request, work)
}

const deniedReason = (denial: ReadAdmissionDenial) => {
  if (denial.body.code === 'INVENTORY_LIMIT') return 'limit'
  if (denial.body.code === 'INVENTORY_AUTHORIZATION_CHANGED') return 'authority-changed'
  if (denial.body.code === 'ORGANIZATION_PERMISSION_REQUIRED') return 'permission-denied'
  if (denial.status === 404) return 'source-unavailable'
  return 'scope-denied'
}

export const admitInventory = async (
  session: SessionAccount | null,
  request: InventoryAdmissionRequest,
  work: ReadAdmissionWork = immediateReadWork,
): Promise<InventoryAdmission> => {
  let admission: InventoryAdmission
  try {
    admission = await work.run((slot = immediateReadWork) =>
      admitInventoryRequest(session, request, slot),
    )
  } catch (error) {
    if (session && request.scope === 'corporation') {
      await work.run(() =>
        recordInventoryAccessDecision({
          actorUserId: session.userId,
          corporationId: null,
          accessKind: 'aggregate',
          decision: 'denied',
          reason: 'source-unavailable',
          subjects: [],
        }),
      )
    }
    throw error
  }
  if (!admission.admitted && session && request.scope === 'corporation') {
    await work.run(() =>
      recordInventoryAccessDecision({
        actorUserId: session.userId,
        corporationId: null,
        accessKind: 'aggregate',
        decision: 'denied',
        reason: deniedReason(admission),
        subjects: [],
      }),
    )
  }
  return admission
}

const originalRequest = (binding: InventoryBinding): InventoryAdmissionRequest =>
  binding.scope === 'personal'
    ? { scope: 'personal', characterIds: binding.selection }
    : {
        scope: 'corporation',
        corporationId: binding.corporationId,
        characterIds: binding.selection,
        declaration: binding.declaration,
      }

const recheckInventory = async (
  binding: InventoryBinding,
  session: SessionAccount | null,
  work: ReadAdmissionWork = immediateReadWork,
): Promise<ReadAdmissionDenial | null> => {
  if (session?.userId !== binding.actorUserId)
    return inventoryDenial('INVENTORY_AUTHORIZATION_CHANGED')
  const current = await admitInventoryRequest(session, originalRequest(binding), work)
  if (!current.admitted) return current
  return current.binding.fingerprint === binding.fingerprint
    ? null
    : inventoryDenial('INVENTORY_AUTHORIZATION_CHANGED')
}

export const createInventoryReadGuard = (
  binding: InventoryBinding,
  liveSession: (work?: ReadAdmissionWork) => Promise<SessionAccount | null>,
  work: ReadAdmissionWork = immediateReadWork,
  options: { readonly signal?: AbortSignal; readonly accessKind?: 'aggregate' | 'holders' } = {},
) => {
  const signal = options.signal ?? new AbortController().signal
  let denialAudit: Promise<void> | undefined
  const recordDenial = (
    reason: 'authority-changed' | 'scope-denied',
    auditWork: ReadAdmissionWork = work,
    accessKind: 'aggregate' | 'holders' = options.accessKind ?? 'aggregate',
  ) => {
    if (binding.scope === 'personal') return Promise.resolve()
    denialAudit ??= auditWork.run(() =>
      recordInventoryAccessDecision({
        actorUserId: binding.actorUserId,
        corporationId: null,
        expectedOrganizationVersion: binding.organization.organizationVersion,
        expectedPolicyVersion: binding.policyVersion,
        accessKind,
        decision: 'denied',
        reason,
        subjects: [],
      }),
    )
    return denialAudit
  }
  const assertCurrent = (checkWork: ReadAdmissionWork = work) =>
    checkWork.run(async (slot = immediateReadWork) => {
      signal.throwIfAborted()
      const denied = await recheckInventory(binding, await liveSession(slot), slot)
      if (denied) await recordDenial('authority-changed', slot)
      assertReadAdmission(denied)
      signal.throwIfAborted()
    })
  const runSource = async <Result>(
    load: (
      subjects: InventoryBinding['evidenceSubjects'],
      slot: ReadAdmissionWork,
    ) => Promise<Result>,
  ): Promise<Result> => {
    await assertCurrent()
    const result = await work.run(async (slot = immediateReadWork) => {
      await assertCurrent(slot)
      return load(binding.evidenceSubjects, slot)
    })
    await assertCurrent()
    return result
  }
  const audit = async (accessKind: 'aggregate' | 'holders', holderIds?: readonly number[]) => {
    if (binding.scope === 'personal') return
    const selected =
      holderIds === undefined
        ? binding.subjects
        : binding.subjects.filter((subject) => holderIds.includes(subject.characterId))
    if (
      (accessKind === 'holders' && holderIds === undefined) ||
      (holderIds &&
        (holderIds.length > 100 ||
          new Set(holderIds).size !== selected.length ||
          selected.some((subject) => !subject.evidenceReadable)))
    ) {
      await recordDenial('scope-denied', work, accessKind)
      throw new Error('Inventory holder scope is unavailable')
    }
    await work.run(() =>
      recordInventoryAccessDecision({
        actorUserId: binding.actorUserId,
        corporationId: binding.corporationId,
        expectedOrganizationVersion: binding.organization.organizationVersion,
        expectedPolicyVersion: binding.policyVersion,
        accessKind,
        decision: 'allowed',
        reason: 'authorized',
        subjects: selected.map((subject) => ({
          userId: subject.userId,
          characterId: subject.characterId,
          characterLifecycle: subject.characterLifecycle,
          memberLifecycle: subject.memberLifecycle,
          authorizationGeneration: subject.authorizationGeneration,
          disclosureRevision: subject.disclosureRevision,
          sectionActivationRevision: subject.sectionActivationRevision,
          evidenceReadable: subject.evidenceReadable,
        })),
      }),
    )
  }
  const release = async <Result>(
    result: Result,
    accessKind: 'aggregate' | 'holders' = 'aggregate',
    holderIds?: readonly number[],
  ): Promise<Result> => {
    await assertCurrent()
    await audit(accessKind, holderIds)
    await assertCurrent()
    return result
  }
  return Object.freeze({ identity: binding.fingerprint, assertCurrent, runSource, release })
}

export const personalInventoryEvidenceAdmission = (
  binding: PersonalInventoryBinding,
): PlatformAdmittedPersonalInventory => {
  const evidence: Pick<
    PlatformAdmittedPersonalInventory,
    'scope' | 'actorUserId' | 'fingerprint' | 'subjects'
  > = {
    scope: 'personal',
    actorUserId: binding.actorUserId,
    fingerprint: binding.fingerprint,
    subjects: binding.evidenceSubjects,
  }
  // SAFETY: Only core admission constructs this nominal capability; coverage-only subjects never cross the source boundary.
  return Object.freeze(evidence) as PlatformAdmittedPersonalInventory
}

export const corporationInventoryEvidenceAdmission = (
  binding: CorporationInventoryBinding,
): PlatformAdmittedCorporationInventory => {
  const evidence: Pick<
    PlatformAdmittedCorporationInventory,
    | 'scope'
    | 'actorUserId'
    | 'corporationId'
    | 'organizationVersion'
    | 'authorizationRevision'
    | 'fingerprint'
    | 'subjects'
  > = {
    scope: 'corporation',
    actorUserId: binding.actorUserId,
    corporationId: binding.corporationId,
    organizationVersion: binding.organization.organizationVersion,
    authorizationRevision: binding.policyVersion,
    fingerprint: binding.fingerprint,
    subjects: binding.evidenceSubjects,
  }
  // SAFETY: The provider receives only the fixed core-admitted evidence subset, without coverage-only authority.
  return Object.freeze(evidence) as PlatformAdmittedCorporationInventory
}
