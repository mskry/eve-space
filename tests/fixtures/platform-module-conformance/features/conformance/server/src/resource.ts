import {
  definePlatformBoundedCollectionResource,
  definePlatformSingleRequestResource,
  type PlatformCharacterResourceSubject,
  type PlatformResourceMaterializationContext,
} from '@eve-space/platform-module-contract/resources'
import type {
  PlatformCoreEsiOperationProtocol,
  PlatformExecutableEsiOperationProtocol,
} from '@eve-space/platform-module-server'
import type { conformanceStatusOperation } from './operation.js'
import type {
  ConformanceSnapshotReadPersistence,
  ConformanceSnapshotWritePersistence,
} from './persistence.js'

interface ConformanceStatusProjection {
  readonly players: number
  readonly publishedTypeCount?: number
  readonly sdeBuildNumber?: number
  readonly characterName?: string | null
  readonly previousPlayers?: number | null
}

type ConformanceStatusProtocol = PlatformExecutableEsiOperationProtocol<
  { readonly 'conformance-status-operation': typeof conformanceStatusOperation },
  'conformance-status-operation'
>
type ConformanceCollectionProtocol = ConformanceStatusProtocol &
  PlatformCoreEsiOperationProtocol<'universe-resolve-names'>
type ConformanceMaterializationContext = PlatformResourceMaterializationContext<
  ConformanceStatusProjection,
  PlatformCharacterResourceSubject,
  ConformanceSnapshotWritePersistence
>

export const conformanceStatusResource = definePlatformSingleRequestResource<
  'conformance-status-operation',
  ConformanceStatusProtocol,
  ConformanceStatusProjection,
  string,
  unknown,
  PlatformCharacterResourceSubject,
  readonly ['published-type-groups'],
  ConformanceSnapshotWritePersistence
>({
  mode: 'single-request',
  operation: 'conformance-status-operation',
  request: () => ({}),
  async map({ data, capabilities }) {
    const typeGroups = await capabilities.coreData.publishedTypeGroups({ typeIds: [34] })
    return {
      players: data.players,
      publishedTypeCount: typeGroups.rows.length,
      sdeBuildNumber: typeGroups.revision.buildNumber,
    }
  },
  materialize: materializeConformanceStatus,
})

export const conformanceCollectionResource = definePlatformBoundedCollectionResource<
  'conformance-status-operation',
  ConformanceCollectionProtocol,
  ConformanceStatusProjection,
  string,
  unknown,
  PlatformCharacterResourceSubject,
  readonly [],
  ConformanceSnapshotReadPersistence,
  ConformanceSnapshotWritePersistence
>({
  mode: 'bounded-collection',
  operation: 'conformance-status-operation',
  async collect(context) {
    const previous = await context.capabilities.persistence.readConformanceSnapshot({
      characterId: context.subject.characterId,
    })
    const status = await context.operations['conformance-status-operation']({})
    const names = await context.operations['universe-resolve-names']({
      body: [context.subject.characterId],
    })
    return {
      complete: true,
      data: {
        players: status.data.players,
        characterName:
          names.data.find(({ id }) => id === context.subject.characterId)?.name ?? null,
        previousPlayers: previous?.pilotsOnline ?? null,
      },
    }
  },
  materialize: materializeConformanceStatus,
})

async function materializeConformanceStatus({
  subject,
  data,
  validatedAt,
  capabilities,
}: ConformanceMaterializationContext) {
  await capabilities.persistence.upsertConformanceSnapshot({
    characterId: subject.characterId,
    pilotsOnline: data.players,
    validatedAt,
  })
  capabilities.logger.info('conformance.resource.materialized', {
    characterId: subject.characterId,
  })
}
