import { recheckOwnedRead, type OwnedReadBinding } from './read-admission.js'
import type { ReadAdmissionWork } from './read-work.js'
import type { SessionAccount } from './session-store.js'
import { assertReadAdmission } from './read-policy.js'

export const createAdmittedOwnedRead = <Input, Result>(
  binding: OwnedReadBinding,
  liveSession: () => Promise<SessionAccount | null>,
  load: (binding: OwnedReadBinding, input: Input) => Promise<Result>,
  work?: ReadAdmissionWork,
) => {
  const fixed = Object.freeze({ ...binding, character: Object.freeze({ ...binding.character }) })
  const assertCurrent = async () =>
    assertReadAdmission(await recheckOwnedRead(fixed, await liveSession(), work))
  return Object.freeze({
    binding: fixed,
    identity: JSON.stringify([
      fixed.userId,
      fixed.character.characterId,
      fixed.character.subjectLifecycleId,
      fixed.authorizationRevision,
      fixed.requiredScope ?? null,
    ]),
    assertCurrent,
    read: async (input: Input): Promise<Result> => {
      await assertCurrent()
      const result = await load(fixed, input)
      await assertCurrent()
      return result
    },
  })
}
