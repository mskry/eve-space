import { expectTypeOf } from 'vitest'
import { execute } from '../../src/esi-resilience/execute.js'
import { defineCharacterEsiRepresentation } from '../../src/esi-resilience/representations.js'
import type { EsiCachedResult } from '../../src/esi-resilience/types.js'

interface SkillsFixtureInput {
  characterId: number
}

interface SkillsFixtureResult {
  totalSp: number
}

const representation = defineCharacterEsiRepresentation<
  'skills',
  SkillsFixtureInput,
  SkillsFixtureResult
>({
  operation: 'skills',
  name: 'character-skills-typing-fixture',
  encodeIdentity: (input) => ({ characterId: input.characterId }),
  load: async (input) => ({
    data: { totalSp: input.characterId },
    meta: { status: 200, headers: {} },
  }),
})

expectTypeOf(execute(representation, { characterId: 1 })).toEqualTypeOf<
  Promise<EsiCachedResult<SkillsFixtureResult>>
>()

// @ts-expect-error the representation's input type rejects an unrelated field name
execute(representation, { character_id: 1 })

// @ts-expect-error the representation's input type rejects a missing required field
execute(representation, {})

async function assertResultTypeFlowsThroughExecute() {
  const result = await execute(representation, { characterId: 1 })
  // @ts-expect-error the mapped result type cannot be assigned to an incompatible shape
  const wrongShape: { unallocatedSp: number } = result.data
  return wrongShape
}
void assertResultTypeFlowsThroughExecute
