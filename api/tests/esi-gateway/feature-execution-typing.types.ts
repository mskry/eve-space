import { operationRegistry } from '@evespace/esi-client/operations'
import { expectTypeOf } from 'vitest'
import { z } from 'zod'
import {
  createCharacterEsiMutation,
  createCharacterEsiRead,
  createPublicEsiRead,
  type EsiCharacterReadResult,
  type EsiReadResult,
  type RegisteredPublicEsiRead,
} from '../../src/esi-gateway/feature-execution.js'

const status = createPublicEsiRead({
  cacheSchema: z.object({ playerCount: z.number() }),
  descriptor: operationRegistry.GetStatus.transport,
  encodeRequest: (_input: undefined) => ({}),
  map: ({ data }) => ({ playerCount: data.players }),
  name: 'callable-status-typing',
  operation: 'status',
})

expectTypeOf(status.operation).toEqualTypeOf<'status'>()
expectTypeOf(status.requiredScope).toEqualTypeOf<null>()
expectTypeOf(status.execute(undefined)).toEqualTypeOf<
  Promise<EsiReadResult<{ playerCount: number }>>
>()

// @ts-expect-error only a factory can construct the opaque registered type
const forged: RegisteredPublicEsiRead<'status', undefined, { playerCount: number }> = {
  execute: () => status.execute(undefined),
  operation: 'status',
  requiredScope: null,
}
void forged

const skills = createCharacterEsiRead({
  cacheSchema: z.object({ totalSp: z.number() }),
  descriptor: operationRegistry.GetCharactersCharacterIdSkills.transport,
  encodeRequest: (input: { characterId: number; subjectLifecycleId: string }) => ({
    path: { character_id: input.characterId },
  }),
  map: ({ data }) => ({ totalSp: data.total_sp }),
  name: 'callable-skills-typing',
  operation: 'skills',
})

expectTypeOf(skills.execute({ characterId: 1, subjectLifecycleId: 'lifecycle' })).toEqualTypeOf<
  Promise<EsiCharacterReadResult<{ totalSp: number }>>
>()

// @ts-expect-error character callables require lifecycle authority in their single input
skills.execute({ characterId: 1 })

const mutation = createCharacterEsiMutation({
  descriptor: operationRegistry.PostCharactersCharacterIdMail.transport,
  encodeRequest: (input: { characterId: number; subjectLifecycleId: string }) => ({
    path: { character_id: input.characterId },
    body: { approved_cost: 0, body: '', recipients: [], subject: '' },
  }),
  map: ({ data }) => data,
  name: 'callable-mail-send-typing',
  operation: 'mail-send',
})

expectTypeOf(mutation.execute({ characterId: 1, subjectLifecycleId: 'lifecycle' })).toEqualTypeOf<
  Promise<number>
>()

// @ts-expect-error mutation confirmation is not caller-supplied
mutation.execute({ characterId: 1, subjectLifecycleId: 'lifecycle' }, { confirmMutation: true })

createCharacterEsiRead({
  operation: 'skills',
  name: 'callable-skills-header-typing',
  descriptor: operationRegistry.GetCharactersCharacterIdSkills.transport,
  cacheSchema: operationRegistry.GetCharactersCharacterIdSkills.responseSchema,
  // @ts-expect-error revalidation headers remain executor-owned
  encodeRequest: (input: { characterId: number; subjectLifecycleId: string }) => ({
    headers: { 'If-None-Match': 'caller-value' },
    path: { character_id: input.characterId },
  }),
  map: ({ data }) => data,
})

createCharacterEsiMutation({
  // @ts-expect-error read operations cannot be declared as callable mutations
  operation: 'skills',
  name: 'callable-invalid-mutation-typing',
  descriptor: operationRegistry.GetCharactersCharacterIdSkills.transport,
  encodeRequest: (input: { characterId: number; subjectLifecycleId: string }) => ({
    path: { character_id: input.characterId },
  }),
  map: ({ data }) => data,
})
