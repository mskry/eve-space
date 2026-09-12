import { operationRegistry } from '@evespace/esi-client/operations'
import { expectTypeOf } from 'vitest'
import {
  createCharacterEsiMutation,
  createCharacterEsiRead,
  createPublicEsiRead,
  type EsiReadResult,
  type RegisteredPublicEsiRead,
} from '../../src/esi-gateway/feature-execution.js'

const status = createPublicEsiRead({
  operation: 'status',
  name: 'callable-status-typing',
  descriptor: operationRegistry.GetStatus.transport,
  encodeRequest: (_input: undefined) => ({}),
  map: ({ data }) => ({ playerCount: data.players }),
})

expectTypeOf(status.operation).toEqualTypeOf<'status'>()
expectTypeOf(status.requiredScope).toEqualTypeOf<null>()
expectTypeOf(status.execute(undefined)).toEqualTypeOf<
  Promise<EsiReadResult<{ playerCount: number }>>
>()

// @ts-expect-error only a factory can construct the opaque registered type
const forged: RegisteredPublicEsiRead<'status', undefined, { playerCount: number }> = {
  operation: 'status',
  requiredScope: null,
  execute: () => status.execute(undefined),
}
void forged

const skills = createCharacterEsiRead({
  operation: 'skills',
  name: 'callable-skills-typing',
  descriptor: operationRegistry.GetCharactersCharacterIdSkills.transport,
  encodeRequest: (input: { characterId: number; subjectLifecycleId: string }) => ({
    path: { character_id: input.characterId },
  }),
  map: ({ data }) => ({ totalSp: data.total_sp }),
})

expectTypeOf(skills.execute({ characterId: 1, subjectLifecycleId: 'lifecycle' })).toEqualTypeOf<
  Promise<EsiReadResult<{ totalSp: number }>>
>()

// @ts-expect-error character callables require lifecycle authority in their single input
skills.execute({ characterId: 1 })

const mutation = createCharacterEsiMutation({
  operation: 'mail-send',
  name: 'callable-mail-send-typing',
  descriptor: operationRegistry.PostCharactersCharacterIdMail.transport,
  encodeRequest: (input: { characterId: number; subjectLifecycleId: string }) => ({
    path: { character_id: input.characterId },
    body: { approved_cost: 0, body: '', recipients: [], subject: '' },
  }),
  map: ({ data }) => data,
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
  // @ts-expect-error revalidation headers remain executor-owned
  encodeRequest: (input: { characterId: number; subjectLifecycleId: string }) => ({
    path: { character_id: input.characterId },
    headers: { 'If-None-Match': 'caller-value' },
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
