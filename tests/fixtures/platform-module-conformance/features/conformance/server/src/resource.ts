import {
  definePlatformResourceOperation,
  type PlatformCharacterResourceSubject,
} from '@eve-space/platform-module-contract'

interface ConformanceStatusData {
  readonly players: number
}

interface ConformanceStatusProjection extends ConformanceStatusData {
  readonly publishedTypeCount?: number
  readonly sdeBuildNumber?: number
}

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
  async materialize({ subject, data, validatedAt, capabilities }) {
    await capabilities.persistence.transaction(async (transaction) => {
      await transaction.query(
        `insert into conformance_snapshots (character_id, pilots_online, validated_at)
         values ($1, $2, $3)
         on conflict (character_id) do update
         set pilots_online = excluded.pilots_online,
             validated_at = excluded.validated_at`,
        [subject.characterId, data.players, validatedAt],
      )
    })
    capabilities.logger.info('conformance.resource.materialized', {
      characterId: subject.characterId,
    })
  },
})
