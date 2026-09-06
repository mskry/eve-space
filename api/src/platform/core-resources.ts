import type {
  PlatformAllianceResourceSubject,
  PlatformCorporationResourceSubject,
  PlatformInstalledResourceDescriptor,
  PlatformResourceOperationImplementation,
} from '@eve-space/platform-module-contract'
import { normalizePositiveSafeIntegerIds } from './resource-id-list.js'

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
    return normalizePositiveSafeIntegerIds(data, 'Alliance corporation collection')
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
    return normalizePositiveSafeIntegerIds(data, 'Corporation roster')
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
