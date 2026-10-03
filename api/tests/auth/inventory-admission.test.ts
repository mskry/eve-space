import { beforeEach, describe, expect, it, vi } from 'vitest'

const boundary = vi.hoisted(() => ({ load: vi.fn(), recover: vi.fn() }))
vi.mock('../../src/auth/inventory-subject-store.js', () => ({
  loadPersonalInventorySubjects: boundary.load,
}))
vi.mock('../../src/auth/tokens.js', () => ({
  schedulePendingCharacterTokenRecovery: boundary.recover,
}))

import {
  admitPersonalInventory,
  recheckPersonalInventory,
} from '../../src/auth/inventory-admission.js'
import { inventoryAssetsScope } from '../../src/inventory-policy.js'

const session = {
  userId: 'owner',
  mainCharacter: {
    characterId: 1,
    name: 'Pilot',
    corporationId: 98,
    allianceId: null,
    isMain: true,
  },
}
const subjects = [1, 2, 3].map((characterId) => ({
  characterId,
  characterName: `Pilot ${characterId}`,
  userId: 'owner',
  characterLifecycle: `lifecycle-${characterId}`,
  authorizationRevision: 7,
  scopes: [inventoryAssetsScope],
  pendingAttemptId: null,
}))

beforeEach(() => {
  boundary.load.mockImplementation(async (_user, selection) =>
    subjects.filter(
      (subject) => selection === undefined || selection.includes(subject.characterId),
    ),
  )
})

describe('personal inventory subject admission', () => {
  it('defaults to every attached character and canonicalizes an explicit narrowing selection', async () => {
    const all = await admitPersonalInventory(session)
    if (!all.admitted) throw new Error('Expected default admission')
    expect(all.binding.subjects.map((subject) => subject.characterId)).toEqual([1, 2, 3])
    const narrowed = await admitPersonalInventory(session, [3, 1, 3])
    const reordered = await admitPersonalInventory(session, [1, 3])
    if (!narrowed.admitted || !reordered.admitted) throw new Error('Expected subset admission')
    expect(narrowed.binding.subjects.map((subject) => subject.characterId)).toEqual([1, 3])
    expect(narrowed.binding.fingerprint).toBe(reordered.binding.fingerprint)
    expect(Object.isFrozen(narrowed.binding.subjects[0])).toBe(true)
  })

  it('keeps an explicit empty set distinct from default selection', async () => {
    const empty = await admitPersonalInventory(session, [])
    expect(empty).toMatchObject({
      admitted: true,
      binding: { subjects: [], evidenceSubjects: [], selection: [] },
    })
  })

  it('denies unknown and non-owned selections without resolving either identity', async () => {
    const unknown = await admitPersonalInventory(session, [1, 90])
    const nonOwned = await admitPersonalInventory(session, [1, 91])
    expect(unknown).toEqual(nonOwned)
    expect(unknown).toMatchObject({ admitted: false, body: { code: 'INVENTORY_SCOPE_DENIED' } })
  })

  it('keeps missing scopes and pending recovery visible without evidence authority', async () => {
    boundary.load.mockResolvedValue([
      subjects[0],
      { ...subjects[1], scopes: [] },
      { ...subjects[2], pendingAttemptId: 'attempt' },
    ])
    const result = await admitPersonalInventory(session)
    if (!result.admitted) throw new Error('Expected coverage admission')
    expect(result.binding.evidenceSubjects.map((subject) => subject.characterId)).toEqual([1])
    expect(result.binding.subjects.map((subject) => subject.coverage)).toEqual([
      null,
      'authorization-required',
      'unavailable',
    ])
    expect(boundary.recover).toHaveBeenCalledWith(3, 'lifecycle-3')
  })

  it.each(['transfer', 'detachment', 'revision', 'pending', 'scope', 'new-character'])(
    'refuses the original set after %s changes',
    async (change) => {
      const result = await admitPersonalInventory(session)
      if (!result.admitted) throw new Error('Expected admission')
      let changed = [...subjects]
      if (change === 'transfer' || change === 'detachment') changed = changed.slice(1)
      if (change === 'revision') changed[0] = { ...changed[0]!, authorizationRevision: 8 }
      if (change === 'scope') changed[0] = { ...changed[0]!, scopes: [] }
      if (change === 'pending')
        boundary.load.mockResolvedValue([
          { ...subjects[0], pendingAttemptId: 'rotation' },
          ...subjects.slice(1),
        ])
      else if (change === 'new-character')
        changed.push({ ...subjects[0]!, characterId: 4, characterLifecycle: 'new' })
      if (change !== 'pending') boundary.load.mockResolvedValue(changed)
      expect(await recheckPersonalInventory(result.binding, session)).toMatchObject({
        admitted: false,
        body: { code: 'INVENTORY_AUTHORIZATION_CHANGED' },
      })
    },
  )

  it('refuses excessive scopes and requires a live owner before batch admission', async () => {
    expect(await admitPersonalInventory(null)).toMatchObject({ status: 401 })
    expect(boundary.load).not.toHaveBeenCalled()
    expect(
      await admitPersonalInventory(
        session,
        Array.from({ length: 21 }, (_, index) => index + 1),
      ),
    ).toMatchObject({ body: { code: 'INVENTORY_LIMIT' } })
    boundary.load.mockResolvedValue(
      Array.from({ length: 21 }, (_, index) => ({ ...subjects[0], characterId: index + 1 })),
    )
    expect(await admitPersonalInventory(session)).toMatchObject({
      body: { code: 'INVENTORY_LIMIT' },
    })
  })
})
