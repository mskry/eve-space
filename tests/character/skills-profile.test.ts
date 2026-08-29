import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const source = (path: string) => readFileSync(resolve(process.cwd(), path), 'utf8')
const route = source('app/pages/characters/[characterId]/skills.vue')
const summary = source('app/components/character/skills/SummaryCard.vue')
const queue = source('app/components/character/skills/Queue.vue')
const queueUtilities = source('app/utils/skill-queue.ts')
const page = [route, summary, queue, queueUtilities].join('\n')

describe('character skills profile', () => {
  it('renders every EVE character attribute with its exported icon', () => {
    for (const attribute of ['charisma', 'intelligence', 'memory', 'perception', 'willpower']) {
      expect(page).toContain(`key: '${attribute}'`)
      expect(
        existsSync(resolve(process.cwd(), `public/images/eve-attributes/${attribute}.png`)),
      ).toBe(true)
    }
    expect(page).toContain('`/images/eve-attributes/${attribute.key}.png`')
  })

  it('reports spendable remaps, and otherwise only a cooldown still ahead', () => {
    expect(page).toContain('profile.bonusRemaps > 0')
    expect(page).toContain("{ kind: 'bonus' as const, count: profile.bonusRemaps }")
    expect(summary).toContain('Date.parse(cooldown) > Date.now()')
    expect(page).toContain("{ kind: 'cooldown' as const, date: cooldown }")
    expect(page).toContain('REMAPS AVAILABLE: {{ remapAvailability.count }}')
    expect(page).toContain('NEXT REMAP:')
    expect(page).toContain('REMAP: AVAILABLE')
    expect(page).not.toContain('attributes.lastRemapDate')
  })

  it('keeps the protected request client-only and character-bound', () => {
    expect(route).toContain('canRunProtectedQuery(')
    expect(route).toContain('import.meta.client')
    expect(route).toContain('authSession.value.authenticated')
    expect(route).toContain('characterId.value')
  })

  it('renders a separately authorized queue with timestamp-derived training rates', () => {
    expect(route).toContain('characterSkillQueueQuery')
    expect(queue).toContain('Skill queue authorization required')
    expect(queue).toContain('trainingRatePerMinute(activeQueueEntry)')
    expect(queueUtilities).toContain('levelEndSp - trainingStartSp')
    expect(queue).not.toContain('cloneState')
    expect(queue).toContain('SP/MIN')
  })
})
