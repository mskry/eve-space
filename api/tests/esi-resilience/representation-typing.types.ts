import { operationRegistry } from '@evespace/esi-client/operations'
import { expectTypeOf } from 'vitest'
import { execute, executeMutation } from '../../src/esi-resilience/execute.js'
import {
  defineCharacterEsiMutation,
  defineCharacterEsiRepresentation,
} from '../../src/esi-resilience/representations.js'
import type { EsiCachedResult } from '../../src/esi-resilience/types.js'

interface SkillsFixtureInput {
  characterId: number
}

interface SkillsFixtureResult {
  totalSp: number
}

const representation = defineCharacterEsiRepresentation({
  operation: 'skills',
  name: 'character-skills-typing-fixture',
  descriptor: operationRegistry.GetCharactersCharacterIdSkills.transport,
  encodeRequest: (input: SkillsFixtureInput) => ({
    path: { character_id: input.characterId },
  }),
  map: ({ data }): SkillsFixtureResult => ({ totalSp: data.total_sp }),
})

expectTypeOf(
  execute(representation, { characterId: 1 }, { subjectLifecycleId: 'lifecycle' }),
).toEqualTypeOf<Promise<EsiCachedResult<SkillsFixtureResult>>>()

// @ts-expect-error the representation's input type rejects an unrelated field name
execute(representation, { character_id: 1 }, { subjectLifecycleId: 'lifecycle' })

// @ts-expect-error the representation's input type rejects a missing required field
execute(representation, {}, { subjectLifecycleId: 'lifecycle' })

defineCharacterEsiRepresentation({
  operation: 'skills',
  name: 'character-skills-invalid-request',
  descriptor: operationRegistry.GetCharactersCharacterIdSkills.transport,
  // @ts-expect-error the bound SDK descriptor requires character_id in the request path
  encodeRequest: () => ({ path: { corporation_id: 1 } }),
  map: ({ data }) => data,
})

defineCharacterEsiRepresentation({
  operation: 'skills',
  name: 'character-skills-invalid-header',
  descriptor: operationRegistry.GetCharactersCharacterIdSkills.transport,
  // @ts-expect-error request headers are executor-owned
  encodeRequest: (input: SkillsFixtureInput) => ({
    path: { character_id: input.characterId },
    headers: {
      'If-None-Match': 'caller-value',
    },
  }),
  map: ({ data }) => data,
})

async function assertResultTypeFlowsThroughExecute() {
  const result = await execute(
    representation,
    { characterId: 1 },
    { subjectLifecycleId: 'lifecycle' },
  )
  // @ts-expect-error the mapped result type cannot be assigned to an incompatible shape
  const wrongShape: { unallocatedSp: number } = result.data
  return wrongShape
}
void assertResultTypeFlowsThroughExecute

const mutation = defineCharacterEsiMutation({
  operation: 'mail-send',
  name: 'mail-send-typing-fixture',
  descriptor: operationRegistry.PostCharactersCharacterIdMail.transport,
  encodeRequest: (input: { characterId: number; subject: string }) => ({
    path: { character_id: input.characterId },
    body: { approved_cost: 0, body: '', recipients: [], subject: input.subject },
  }),
  map: ({ data }, input) => ({ characterId: input.characterId, mailId: data }),
})

expectTypeOf(
  executeMutation(
    mutation,
    { characterId: 1, subject: 'Subject' },
    { subjectLifecycleId: 'lifecycle' },
  ),
).toEqualTypeOf<Promise<{ characterId: number; mailId: number }>>()

// @ts-expect-error read representations cannot obtain mutation confirmation
executeMutation(representation, { characterId: 1 }, { subjectLifecycleId: 'lifecycle' })

// @ts-expect-error mutation representations cannot execute through the read path
execute(mutation, { characterId: 1, subject: 'Subject' }, { subjectLifecycleId: 'lifecycle' })

defineCharacterEsiMutation({
  // @ts-expect-error catalog read operations cannot be declared as mutations
  operation: 'skills',
  name: 'skills-mutation-typing-fixture',
  descriptor: operationRegistry.GetCharactersCharacterIdSkills.transport,
  encodeRequest: (input: SkillsFixtureInput) => ({ path: { character_id: input.characterId } }),
  map: ({ data }) => data,
})
