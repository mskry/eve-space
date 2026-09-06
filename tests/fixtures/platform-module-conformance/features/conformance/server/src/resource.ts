import {
  definePlatformResourceOperation,
  type PlatformCharacterResourceSubject,
} from '@eve-space/platform-module-contract'

interface ConformanceStatusData {
  readonly players: number
}

export const conformanceStatusResource = definePlatformResourceOperation<
  'conformance-status-operation',
  ConformanceStatusData,
  ConformanceStatusData
>({
  operation: 'conformance-status-operation',
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
