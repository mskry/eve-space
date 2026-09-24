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
  map({ data }) {
    return normalizePositiveSafeIntegerIds(data, 'Alliance corporation collection')
  },
  async materialize() {
    throw new Error('Core resource materialization must use the core transaction path')
  },
  mode: 'single-request',
  operation: 'alliance-corporations',
  request(subject) {
    if (subject.kind !== 'alliance') {
      throw new Error('Managed-corporation subject must be an alliance')
    }
    return { path: { alliance_id: subject.allianceId } }
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
  map({ data }) {
    return normalizePositiveSafeIntegerIds(data, 'Corporation roster')
  },
  async materialize() {
    throw new Error('Core resource materialization must use the core transaction path')
  },
  mode: 'single-request',
  operation: 'corporation-members',
  request(subject) {
    if (subject.kind !== 'corporation') {
      throw new Error('Corporation-roster subject must be a corporation')
    }
    return { path: { corporation_id: subject.corporationId } }
  },
}

export const coreResources = [
  {
    eligibility: { kind: 'current-managed-alliance' },
    implementation: managedCorporationsImplementation,
    materializationIntervalSeconds: 3600,
    moduleId: 'core',
    operationId: 'alliance-corporations',
    resourceId: 'managed-corporations',
    subjectKind: 'alliance',
  },
  {
    eligibility: { kind: 'current-managed-corporation-source' },
    implementation: corporationRosterImplementation,
    materializationIntervalSeconds: 3600,
    moduleId: 'core',
    operationId: 'corporation-members',
    resourceId: 'corporation-roster',
    subjectKind: 'corporation',
  },
] as const satisfies readonly PlatformInstalledResourceDescriptor[]
