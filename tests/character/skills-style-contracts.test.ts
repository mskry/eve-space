import { describe, expect, it } from 'vitest'
import { readWorkspaceFile as source } from '../support/read-workspace-file'

const summaryStyles = source('app/assets/css/features/character-summary.css')
const features = source('app/assets/css/features/skills.css')
const responsive = source('app/assets/css/responsive/skills.css')

describe('skills stylesheet structural contracts', () => {
  it('keeps shared summary cards free of diagonal hatching', () => {
    expect(summaryStyles).not.toContain('repeating-linear-gradient')
    expect(features).not.toMatch(/\.character-summary-card\.skills-hero \{[^}]*background:/s)
  })

  it('defines the desktop and responsive column layout', () => {
    expect(features).toMatch(/\.skill-group-chips \{[^}]*columns: 3;[^}]*column-gap: 0\.3125rem/s)
    expect(features).toContain('grid-template-columns: auto minmax(0, 1fr) auto')
    expect(responsive).toMatch(/\.skill-group-chips \{[^}]*columns: 2;/s)
    expect(features).toMatch(/\.skill-group-chip \{[^}]*break-inside: avoid;/s)
    expect(features).toMatch(/\.skill-list \{[^}]*columns: 2;[^}]*column-gap: 0\.125rem/s)
    expect(features).toMatch(/\.skill-row \{[^}]*break-inside: avoid;/s)
    expect(responsive).toMatch(/\.skill-list \{[^}]*columns: 1;/s)
    expect(responsive).toMatch(
      /@media \(max-width: 520px\) \{[\s\S]*\.skill-group-chips \{[^}]*columns: 1;/,
    )
    expect(features).toContain('grid-template-columns: minmax(0, 1fr) minmax(18.75rem, 22rem)')
    expect(responsive).toContain('@media (max-width: 1100px)')
    expect(responsive).toContain('grid-template-columns: 1fr')
    expect(responsive).not.toContain('display: none')
  })

  it('styles the view from semantic tokens rather than literal colours', () => {
    expect(features).not.toMatch(/#[0-9a-fA-F]{3,8}\b/)
    expect(responsive).not.toMatch(/#[0-9a-fA-F]{3,8}\b/)
    expect(features).toContain('var(--ui-primary)')
    expect(features).toContain('var(--ui-warning)')
  })
})
