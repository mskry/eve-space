import type {
  PlatformCharacterResourceSubject,
  PlatformResourceCollectionContext,
  PlatformResourceMaterializationContext,
} from '@eve-space/platform-module-contract/resources'
import type {
  EvidenceCollectionPersistence,
  EvidenceMaterializationPersistence,
} from './persistence.js'

const operationContractRevision = 1
const resourceRevision = 1

type EvidenceCoreDataProductId =
  | 'published-type-groups'
  | 'published-skill-catalogue'
  | 'published-type-details'
  | 'static-location-labels'
type EvidenceScalar = string | number | boolean | null
export type IntentionalEvidence = Readonly<Record<string, EvidenceScalar | EvidenceScalar[]>>
export type EvidenceCheckpoint = Readonly<Record<string, EvidenceScalar>>
export type EvidenceSectionId = 'assets' | 'wallet' | 'mail'
export type EvidenceResourceId =
  | 'assets'
  | 'wallet-journal'
  | 'wallet-transactions'
  | 'mail-headers'
  | 'mail-details'
export type EvidenceRecordKind =
  | 'asset'
  | 'wallet-journal'
  | 'wallet-transaction'
  | 'mail-header'
  | 'mail-content'

export interface StagedEvidenceRecord<Kind extends EvidenceRecordKind = EvidenceRecordKind> {
  readonly recordKind: Kind
  readonly sourceId: string
  readonly sourceTimestamp: string | null
  readonly evidence: IntentionalEvidence
  readonly validatedAt: string
}

interface EvidenceObservationBase<
  Section extends EvidenceSectionId,
  Resource extends EvidenceResourceId,
  Kind extends EvidenceRecordKind,
> {
  readonly sectionId: Section
  readonly resourceId: Resource
  readonly observationId: string
  readonly expectedRevision: number
  readonly checkpoint: EvidenceCheckpoint
  readonly records: readonly StagedEvidenceRecord<Kind>[]
}

export type EvidenceObservation =
  | EvidenceObservationBase<'assets', 'assets', 'asset'>
  | EvidenceObservationBase<'wallet', 'wallet-journal', 'wallet-journal'>
  | EvidenceObservationBase<'wallet', 'wallet-transactions', 'wallet-transaction'>
  | EvidenceObservationBase<'mail', 'mail-headers', 'mail-header'>
  | EvidenceObservationBase<'mail', 'mail-details', 'mail-content'>

export type EvidenceCollectionContext<
  Products extends readonly EvidenceCoreDataProductId[] = readonly [],
> = PlatformResourceCollectionContext<
  PlatformCharacterResourceSubject,
  Products,
  EvidenceCollectionPersistence
>

type EvidenceResourceDefinition =
  | { readonly sectionId: 'assets'; readonly resourceId: 'assets' }
  | {
      readonly sectionId: 'wallet'
      readonly resourceId: 'wallet-journal' | 'wallet-transactions'
    }
  | { readonly sectionId: 'mail'; readonly resourceId: 'mail-headers' | 'mail-details' }

export async function startEvidenceCollection<
  Products extends readonly EvidenceCoreDataProductId[],
>(definition: EvidenceResourceDefinition, context: EvidenceCollectionContext<Products>) {
  const authority = requireCollectionAuthority(definition.sectionId, context)
  const identity = {
    ...definition,
    operationContractRevision,
    resourceRevision,
    organizationVersion: authority.organizationVersion,
    targetUserId: authority.targetUserId,
    managedMemberLifecycleId: authority.managedMemberLifecycleId,
    characterId: context.subject.characterId,
    characterLifecycleId: context.subject.lifecycleId,
    authorizationGeneration: context.authorizationGeneration!,
    disclosureVersion: authority.disclosureVersion,
    sectionActivationVersion: authority.sectionActivationVersion,
  }
  const stored = await context.capabilities.persistence.readActiveEvidenceContinuation(identity)
  return {
    observationId: stored?.observationId ?? globalThis.crypto.randomUUID(),
    expectedRevision: stored?.revision ?? 0,
    checkpoint: stored?.checkpoint ?? {},
  }
}

export async function materializeEvidenceObservation(
  context: PlatformResourceMaterializationContext<
    EvidenceObservation,
    PlatformCharacterResourceSubject,
    EvidenceMaterializationPersistence
  >,
): Promise<void | { readonly outcome: 'obsolete' }> {
  const authority = context.managedAuthority
  const data = context.data
  if (
    context.organizationVersion !== authority?.organizationVersion ||
    context.authorizationGeneration === null ||
    authority.sectionId !== data.sectionId
  )
    return { outcome: 'obsolete' }

  const identity = {
    operationContractRevision,
    resourceRevision,
    organizationVersion: authority.organizationVersion,
    targetUserId: authority.targetUserId,
    managedMemberLifecycleId: authority.managedMemberLifecycleId,
    characterId: context.subject.characterId,
    characterLifecycleId: context.subject.lifecycleId,
    authorizationGeneration: context.authorizationGeneration,
    disclosureVersion: authority.disclosureVersion,
    sectionActivationVersion: authority.sectionActivationVersion,
    observationId: data.observationId,
  }
  const writeResult = await writeObservation(context, identity)
  if (writeResult.outcome === 'obsolete') return { outcome: 'obsolete' }
  if (data.checkpoint.complete !== true) return
  const promoted = await promoteObservation(context, identity, writeResult.revision)
  return promoted.outcome === 'obsolete' ? { outcome: 'obsolete' } : undefined
}

function requireCollectionAuthority<Products extends readonly EvidenceCoreDataProductId[]>(
  sectionId: EvidenceSectionId,
  context: EvidenceCollectionContext<Products>,
) {
  const authority = context.managedAuthority
  if (
    context.organizationVersion !== authority?.organizationVersion ||
    context.authorizationGeneration === null ||
    authority.sectionId !== sectionId
  )
    throw new Error('Member Audit collection authority is unavailable')
  return authority
}

function writeObservation(
  context: PlatformResourceMaterializationContext<
    EvidenceObservation,
    PlatformCharacterResourceSubject,
    EvidenceMaterializationPersistence
  >,
  identity: {
    readonly operationContractRevision: number
    readonly resourceRevision: number
    readonly organizationVersion: number
    readonly targetUserId: string
    readonly managedMemberLifecycleId: string
    readonly characterId: number
    readonly characterLifecycleId: string
    readonly authorizationGeneration: number
    readonly disclosureVersion: number
    readonly sectionActivationVersion: number
    readonly observationId: string
  },
) {
  const data = context.data
  const common = {
    ...identity,
    expectedRevision: data.expectedRevision,
    checkpoint: { ...data.checkpoint },
    updatedAt: context.validatedAt,
  }
  switch (data.resourceId) {
    case 'assets':
      return context.capabilities.persistence.writeEvidenceContinuation({
        ...common,
        sectionId: 'assets',
        resourceId: 'assets',
        records: data.records.map(copyRecord),
      })
    case 'wallet-journal':
      return context.capabilities.persistence.writeEvidenceContinuation({
        ...common,
        sectionId: 'wallet',
        resourceId: 'wallet-journal',
        records: data.records.map(copyRecord),
      })
    case 'wallet-transactions':
      return context.capabilities.persistence.writeEvidenceContinuation({
        ...common,
        sectionId: 'wallet',
        resourceId: 'wallet-transactions',
        records: data.records.map(copyRecord),
      })
    case 'mail-headers':
      return context.capabilities.persistence.writeEvidenceContinuation({
        ...common,
        sectionId: 'mail',
        resourceId: 'mail-headers',
        records: data.records.map(copyRecord),
      })
    case 'mail-details':
      return context.capabilities.persistence.writeEvidenceContinuation({
        ...common,
        sectionId: 'mail',
        resourceId: 'mail-details',
        records: data.records.map(copyRecord),
      })
  }
}

function promoteObservation(
  context: PlatformResourceMaterializationContext<
    EvidenceObservation,
    PlatformCharacterResourceSubject,
    EvidenceMaterializationPersistence
  >,
  identity: {
    readonly operationContractRevision: number
    readonly resourceRevision: number
    readonly organizationVersion: number
    readonly targetUserId: string
    readonly managedMemberLifecycleId: string
    readonly characterId: number
    readonly characterLifecycleId: string
    readonly authorizationGeneration: number
    readonly disclosureVersion: number
    readonly sectionActivationVersion: number
    readonly observationId: string
  },
  expectedRevision: number,
) {
  const common = {
    ...identity,
    expectedRevision,
    dtoRevision: 1,
    validatedAt: context.validatedAt,
  }
  switch (context.data.resourceId) {
    case 'assets':
      return context.capabilities.persistence.promoteEvidenceObservation({
        ...common,
        sectionId: 'assets',
        resourceId: 'assets',
      })
    case 'wallet-journal':
      return context.capabilities.persistence.promoteEvidenceObservation({
        ...common,
        sectionId: 'wallet',
        resourceId: 'wallet-journal',
      })
    case 'wallet-transactions':
      return context.capabilities.persistence.promoteEvidenceObservation({
        ...common,
        sectionId: 'wallet',
        resourceId: 'wallet-transactions',
      })
    case 'mail-headers':
      return context.capabilities.persistence.promoteEvidenceObservation({
        ...common,
        sectionId: 'mail',
        resourceId: 'mail-headers',
      })
    case 'mail-details':
      return context.capabilities.persistence.promoteEvidenceObservation({
        ...common,
        sectionId: 'mail',
        resourceId: 'mail-details',
      })
  }
}

function copyRecord<Kind extends EvidenceRecordKind>(record: StagedEvidenceRecord<Kind>) {
  return {
    ...record,
    evidence: Object.fromEntries(
      Object.entries(record.evidence).map(([key, value]) => [
        key,
        Array.isArray(value) ? [...value] : value,
      ]),
    ),
  }
}
