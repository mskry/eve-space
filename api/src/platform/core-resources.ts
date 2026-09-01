import type {
  PlatformAllianceResourceSubject,
  PlatformCorporationResourceSubject,
  PlatformInstalledResourceDescriptor,
  PlatformResourceOperationImplementation,
  PlatformResourceSubject,
} from '@eve-space/platform-module-contract'

const managedCorporationsImplementation: PlatformResourceOperationImplementation<
  'alliance-corporations',
  readonly number[],
  readonly number[],
  string,
  unknown,
  PlatformAllianceResourceSubject
> = {
  operation: 'alliance-corporations',
  request(subject) {
    if (subject.kind !== 'alliance')
      throw new Error('Managed-corporation subject must be an alliance')
    return { path: { alliance_id: subject.allianceId } }
  },
  map({ data }) {
    return normalizeIds(data, 'Alliance corporation collection')
  },
  async materialize() {
    throw new Error('Core resource materialization must use the core transaction path')
  },
}

const corporationRosterImplementation: PlatformResourceOperationImplementation<
  'corporation-members',
  readonly number[],
  readonly number[],
  string,
  unknown,
  PlatformCorporationResourceSubject
> = {
  operation: 'corporation-members',
  request(subject) {
    if (subject.kind !== 'corporation')
      throw new Error('Corporation-roster subject must be a corporation')
    return { path: { corporation_id: subject.corporationId } }
  },
  map({ data }) {
    return normalizeIds(data, 'Corporation roster')
  },
  async materialize() {
    throw new Error('Core resource materialization must use the core transaction path')
  },
}

export const coreResources = [
  {
    moduleId: 'core',
    resourceId: 'managed-corporations',
    operationId: 'alliance-corporations',
    subjectKind: 'alliance',
    materializationIntervalSeconds: 3_600,
    eligibility: { kind: 'current-managed-alliance' },
    implementation: managedCorporationsImplementation,
  },
  {
    moduleId: 'core',
    resourceId: 'corporation-roster',
    operationId: 'corporation-members',
    subjectKind: 'corporation',
    materializationIntervalSeconds: 3_600,
    eligibility: { kind: 'current-managed-corporation-source' },
    implementation: corporationRosterImplementation,
  },
] as const satisfies readonly PlatformInstalledResourceDescriptor[]

export function toPlatformResourceSubject(input: {
  subjectKind: 'character' | 'corporation' | 'alliance'
  subjectId: string
  subjectLifecycleId: string
}): PlatformResourceSubject | null {
  const id = Number(input.subjectId)
  if (!Number.isSafeInteger(id) || id <= 0) return null
  if (input.subjectKind === 'character')
    return { kind: 'character', characterId: id, lifecycleId: input.subjectLifecycleId }
  if (input.subjectKind === 'corporation')
    return { kind: 'corporation', corporationId: id, lifecycleId: input.subjectLifecycleId }
  return { kind: 'alliance', allianceId: id, lifecycleId: input.subjectLifecycleId }
}

function normalizeIds(ids: readonly number[], label: string) {
  const normalized = [...new Set(ids)]
  if (normalized.some((id) => !Number.isSafeInteger(id) || id <= 0))
    throw new Error(`${label} contains an invalid ID`)
  return normalized.toSorted((left, right) => left - right)
}
