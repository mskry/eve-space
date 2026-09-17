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

    expect(definitions).toEqual([
      expect.objectContaining({
        typeId: 3300,
        primaryAttribute: 'perception',
        secondaryAttribute: 'willpower',
      }),
    ])
    expect(entries).toEqual([
      expect.objectContaining({
        queuePosition: 1,
        typeId: 3300,
        name: 'Gunnery',
        primaryAttribute: 'perception',
        secondaryAttribute: 'willpower',
      }),
      expect.objectContaining({
        queuePosition: 2,
        typeId: 9999,
        name: 'Unknown skill 9999',
        groupId: null,
        groupName: 'Unknown',
      }),
    ])
  })

  test.each([
    [[], 0, { state: 'empty', activeQueuePosition: null }],
    [[queueEntry(0, 1)], 0, { state: 'paused', activeQueuePosition: null }],
    [
      [
        queueEntry(0, 1, '2026-09-17T10:00:00.000Z', '2026-09-17T11:00:00.000Z'),
        queueEntry(1, 2, '2026-09-17T11:00:00.000Z', '2026-09-17T12:00:00.000Z'),
      ],
      Date.parse('2026-09-17T11:30:00.000Z'),
      { state: 'training', activeQueuePosition: 1 },
    ],
    [
      [queueEntry(0, 1, '2026-09-17T10:00:00.000Z', '2026-09-17T11:00:00.000Z')],
      Date.parse('2026-09-17T12:00:00.000Z'),
      { state: 'lapsed', activeQueuePosition: null },
    ],
    [
      [queueEntry(0, 1, '2026-09-17T10:00:00.000Z', null)],
      Date.parse('2026-09-17T12:00:00.000Z'),
      { state: 'paused', activeQueuePosition: null },
    ],
  ] as const)('derives time-dependent queue state', (source, now, expected) => {
    const entries = projectSkillQueueEntries(source, [])
    expect(resolveSkillQueueState(entries, now)).toEqual(expected)
  })
})

function queueEntry(
  queuePosition: number,
  typeId: number,
  startDate: string | null = null,
  finishDate: string | null = null,
): SkillQueueSourceEntry {
  return {
    queuePosition,
    typeId,
    finishedLevel: 5,
    levelStartSp: null,
    levelEndSp: null,
    trainingStartSp: null,
    startDate,
    finishDate,
  }
}

function definitionRow(typeId: number, attributeId: number, attributeValue: number) {
  return {
    typeId,
    typeName: 'Gunnery',
    groupId: 255,
    groupName: 'Gunnery',
    attributeId,
    attributeValue,
  }
}
