import { describe, expect, test } from 'vitest'
import {
  projectSkillQueueDefinitions,
  projectSkillQueueEntries,
  resolveSkillQueueState,
  type SkillQueueSourceEntry,
} from '../src/skill-queue.js'

describe('skill-queue projection', () => {
  test('projects training attributes, stable order, and deterministic unknowns', () => {
    const definitions = projectSkillQueueDefinitions([
      definitionRow(3300, 181, 168),
      definitionRow(3300, 180, 167),
    ])
    const entries = projectSkillQueueEntries(
      [queueEntry(2, 9999), queueEntry(1, 3300)],
      definitions,
    )

    expect(definitions).toStrictEqual([
      expect.objectContaining({
        primaryAttribute: 'perception',
        secondaryAttribute: 'willpower',
        typeId: 3300,
      }),
    ])
    expect(entries).toStrictEqual([
      expect.objectContaining({
        name: 'Gunnery',
        primaryAttribute: 'perception',
        queuePosition: 1,
        secondaryAttribute: 'willpower',
        typeId: 3300,
      }),
      expect.objectContaining({
        groupId: null,
        groupName: 'Unknown',
        name: 'Unknown skill 9999',
        queuePosition: 2,
        typeId: 9999,
      }),
    ])
  })

  test.each([
    [[], 0, { activeQueuePosition: null, state: 'empty' }],
    [[queueEntry(0, 1)], 0, { activeQueuePosition: null, state: 'paused' }],
    [
      [
        queueEntry(0, 1, '2026-09-17T10:00:00.000Z', '2026-09-17T11:00:00.000Z'),
        queueEntry(1, 2, '2026-09-17T11:00:00.000Z', '2026-09-17T12:00:00.000Z'),
      ],
      Date.parse('2026-09-17T11:30:00.000Z'),
      { activeQueuePosition: 1, state: 'training' },
    ],
    [
      [queueEntry(0, 1, '2026-09-17T10:00:00.000Z', '2026-09-17T11:00:00.000Z')],
      Date.parse('2026-09-17T12:00:00.000Z'),
      { activeQueuePosition: null, state: 'lapsed' },
    ],
    [
      [queueEntry(0, 1, '2026-09-17T10:00:00.000Z', null)],
      Date.parse('2026-09-17T12:00:00.000Z'),
      { activeQueuePosition: null, state: 'paused' },
    ],
  ] as const)('derives time-dependent queue state', (source, now, expected) => {
    const entries = projectSkillQueueEntries(source, [])
    expect(resolveSkillQueueState(entries, now)).toStrictEqual(expected)
  })
})

function queueEntry(
  queuePosition: number,
  typeId: number,
  startDate: string | null = null,
  finishDate: string | null = null,
): SkillQueueSourceEntry {
  return {
    finishDate,
    finishedLevel: 5,
    levelEndSp: null,
    levelStartSp: null,
    queuePosition,
    startDate,
    trainingStartSp: null,
    typeId,
  }
}

function definitionRow(typeId: number, attributeId: number, attributeValue: number) {
  return {
    attributeId,
    attributeValue,
    groupId: 255,
    groupName: 'Gunnery',
    typeId,
    typeName: 'Gunnery',
  }
}
