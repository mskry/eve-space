import {
  definePlatformResourceOperation,
  type PlatformCharacterResourceSubject,
  type PlatformResourceMaterializationContext,
} from '@eve-space/platform-module-contract/resources'
import type { ConformanceSnapshotWritePersistence } from './persistence.js'

interface ConformanceStatusData {
  readonly players: number
}

interface ConformanceStatusProjection extends ConformanceStatusData {
  readonly publishedTypeCount?: number
  readonly sdeBuildNumber?: number
}

type ConformanceMaterializationContext = PlatformResourceMaterializationContext<
  ConformanceStatusProjection,
  PlatformCharacterResourceSubject,
  ConformanceSnapshotWritePersistence
>

export const conformanceStatusResource = definePlatformResourceOperation<
  'conformance-status-operation',
  ConformanceStatusData,
  ConformanceStatusProjection,
  string,
  unknown,
  readonly ['published-type-groups']
>({
  operation: 'conformance-status-operation',
  async collect(context) {
    const observation = await context.execute('conformance-status-operation', {})
    const data = observation.data as ConformanceStatusData
    const typeGroups = await context.capabilities.coreData.publishedTypeGroups({ typeIds: [34] })
    return {
      complete: true,
      data: {
        players: data.players,
        publishedTypeCount: typeGroups.rows.length,
        sdeBuildNumber: typeGroups.revision.buildNumber,
      },
    }
  },
  request(_subject: PlatformCharacterResourceSubject) {
    return {}
  },
  map({ data }) {
    return { players: data.players }
  },
  materialize: (context) =>
    materializeConformanceStatus(context as unknown as ConformanceMaterializationContext),
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
