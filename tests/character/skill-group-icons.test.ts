import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { skillGroupIcon, skillGroupIconNames } from '../../app/utils/skill-group-icons'

const source = (path: string) => readFileSync(resolve(process.cwd(), path), 'utf8')
const component = source('app/components/character/skills/GroupIcon.vue')

describe('skillGroupIcon', () => {
  it('slugs every EVE skill group name onto its own glyph', () => {
    expect(skillGroupIcon('Gunnery')).toBe('gunnery')
    expect(skillGroupIcon('Spaceship Command')).toBe('spaceship-command')
    expect(skillGroupIcon('Neural Enhancement')).toBe('neural-enhancement')
    expect(skillGroupIcon('  Resource   Processing ')).toBe('resource-processing')
  })

  it('falls back rather than dropping the glyph for an unrecognised group', () => {
    expect(skillGroupIcon('Unknown')).toBe('unknown')
    expect(skillGroupIcon('Corporate Projects')).toBe('unknown')
    expect(skillGroupIcon('')).toBe('unknown')
  })

  it('covers the twenty-three skill groups the design specifies', () => {
    expect(skillGroupIconNames).toHaveLength(23)
    expect(new Set(skillGroupIconNames).size).toBe(23)
  })
})

describe('skill group glyphs', () => {
  it('draws a branch for every named icon plus an unknown fallback', () => {
    for (const name of skillGroupIconNames) expect(component).toContain(`name === '${name}'`)
    expect(component).toContain('<template v-else>')
  })

  it('keeps the shared 24-grid stroke system the design defines', () => {
    expect(component).toContain('viewBox="0 0 24 24"')
    expect(component).toContain('fill="none"')
    expect(component).toContain('aria-hidden="true"')
    expect(component).not.toContain('stroke-width="1"')
  })
})
