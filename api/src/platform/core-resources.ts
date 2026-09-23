import type {
  PlatformAllianceResourceSubject,
  PlatformCorporationResourceSubject,
  PlatformInstalledResourceDescriptor,
  PlatformSingleRequestResourceImplementation,
} from '@eve-space/platform-module-contract/resources'
import type { PlatformEsiOperationProtocol } from '../esi-gateway/catalog-interface.js'
import { normalizePositiveSafeIntegerIds } from './resource-id-list.js'

const managedCorporationsImplementation: PlatformSingleRequestResourceImplementation<
  'alliance-corporations',
  PlatformEsiOperationProtocol<'alliance-corporations'>,
  readonly number[],
  string,
  unknown,
  PlatformAllianceResourceSubject
> = {
  mode: 'single-request',
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

const corporationRosterImplementation: PlatformSingleRequestResourceImplementation<
  'corporation-members',
  PlatformEsiOperationProtocol<'corporation-members'>,
  readonly number[],
  string,
  unknown,
  PlatformCorporationResourceSubject
> = {
  mode: 'single-request',
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
