import type {
  PlatformCharacterResourceSubject,
  PlatformResourceCollectionContext,
  PlatformResourceMaterializationContext,
  PlatformResourceOperationProtocol,
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
type EvidenceCheckpoint = Readonly<Record<string, EvidenceScalar>>
export type EvidenceSectionId = 'assets' | 'wallet' | 'mail'
type EvidenceResourceId =
  | 'assets'
  | 'wallet-journal'
  | 'wallet-transactions'
  | 'mail-headers'
  | 'mail-details'
type EvidenceRecordKind =
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
  Protocol extends PlatformResourceOperationProtocol,
  Products extends readonly EvidenceCoreDataProductId[] = readonly [],
> = PlatformResourceCollectionContext<
  PlatformCharacterResourceSubject,
  Protocol,
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
  Protocol extends PlatformResourceOperationProtocol,
  Products extends readonly EvidenceCoreDataProductId[],
>(definition: EvidenceResourceDefinition, context: EvidenceCollectionContext<Protocol, Products>) {
  const authority = requireCollectionAuthority(definition.sectionId, context)
  const identity = {
    ...definition,
    authorizationGeneration: context.authorizationGeneration!,
    characterId: context.subject.characterId,
    characterLifecycleId: context.subject.lifecycleId,
    disclosureVersion: authority.disclosureVersion,
    managedMemberLifecycleId: authority.managedMemberLifecycleId,
    operationContractRevision,
    organizationVersion: authority.organizationVersion,
    resourceRevision,
    sectionActivationVersion: authority.sectionActivationVersion,
    targetUserId: authority.targetUserId,
  }
  const stored = await context.capabilities.persistence.readActiveEvidenceContinuation(identity)
  return {
    checkpoint: stored?.checkpoint ?? {},
    expectedRevision: stored?.revision ?? 0,
    observationId: stored?.observationId ?? globalThis.crypto.randomUUID(),
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
  ) {
    return { outcome: 'obsolete' }
  }

  const identity = {
    authorizationGeneration: context.authorizationGeneration,
    characterId: context.subject.characterId,
    characterLifecycleId: context.subject.lifecycleId,
    disclosureVersion: authority.disclosureVersion,
    managedMemberLifecycleId: authority.managedMemberLifecycleId,
    observationId: data.observationId,
    operationContractRevision,
    organizationVersion: authority.organizationVersion,
    resourceRevision,
    sectionActivationVersion: authority.sectionActivationVersion,
    targetUserId: authority.targetUserId,
  }
  const writeResult = await writeObservation(context, identity)
  if (writeResult.outcome === 'obsolete') {
    return { outcome: 'obsolete' }
  }
  if (data.checkpoint.complete !== true) {
    return
  }
  const promoted = await promoteObservation(context, identity, writeResult.revision)
  return promoted.outcome === 'obsolete' ? { outcome: 'obsolete' } : undefined
}

function requireCollectionAuthority<
  Protocol extends PlatformResourceOperationProtocol,
  Products extends readonly EvidenceCoreDataProductId[],
>(sectionId: EvidenceSectionId, context: EvidenceCollectionContext<Protocol, Products>) {
  const authority = context.managedAuthority
  if (
    context.organizationVersion !== authority?.organizationVersion ||
    context.authorizationGeneration === null ||
    authority.sectionId !== sectionId
  ) {
    throw new Error('Member Audit collection authority is unavailable')
  }
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
    checkpoint: { ...data.checkpoint },
    expectedRevision: data.expectedRevision,
    updatedAt: context.validatedAt,
  }
  switch (data.resourceId) {
    case 'assets':
      return context.capabilities.persistence.writeEvidenceContinuation({
        ...common,
        records: data.records.map(copyRecord),
        resourceId: 'assets',
        sectionId: 'assets',
      })
    case 'wallet-journal':
      return context.capabilities.persistence.writeEvidenceContinuation({
        ...common,
        records: data.records.map(copyRecord),
        resourceId: 'wallet-journal',
        sectionId: 'wallet',
      })
    case 'wallet-transactions':
      return context.capabilities.persistence.writeEvidenceContinuation({
        ...common,
        records: data.records.map(copyRecord),
        resourceId: 'wallet-transactions',
        sectionId: 'wallet',
      })
    case 'mail-headers':
      return context.capabilities.persistence.writeEvidenceContinuation({
        ...common,
        records: data.records.map(copyRecord),
        resourceId: 'mail-headers',
        sectionId: 'mail',
      })
    case 'mail-details':
      return context.capabilities.persistence.writeEvidenceContinuation({
        ...common,
        records: data.records.map(copyRecord),
        resourceId: 'mail-details',
        sectionId: 'mail',
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
    dtoRevision: 1,
    expectedRevision,
    validatedAt: context.validatedAt,
  }
  switch (context.data.resourceId) {
    case 'assets':
      return context.capabilities.persistence.promoteEvidenceObservation({
        ...common,
        resourceId: 'assets',
        sectionId: 'assets',
      })
    case 'wallet-journal':
      return context.capabilities.persistence.promoteEvidenceObservation({
        ...common,
        resourceId: 'wallet-journal',
        sectionId: 'wallet',
      })
    case 'wallet-transactions':
      return context.capabilities.persistence.promoteEvidenceObservation({
        ...common,
        resourceId: 'wallet-transactions',
        sectionId: 'wallet',
      })
    case 'mail-headers':
      return context.capabilities.persistence.promoteEvidenceObservation({
        ...common,
        resourceId: 'mail-headers',
        sectionId: 'mail',
      })
    case 'mail-details':
      return context.capabilities.persistence.promoteEvidenceObservation({
        ...common,
        resourceId: 'mail-details',
        sectionId: 'mail',
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
