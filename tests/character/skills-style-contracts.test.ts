import { describe, expect, it } from 'vitest'
import { readWorkspaceFile as source } from '../support/read-workspace-file'

const features = source('app/assets/css/features/skills.css')
const responsive = source('app/assets/css/responsive/skills.css')

describe('skills stylesheet structural contracts', () => {
  it('styles the view from semantic tokens rather than literal colours', () => {
    expect(features).not.toMatch(/#[0-9a-fA-F]{3,8}\b/)
    expect(responsive).not.toMatch(/#[0-9a-fA-F]{3,8}\b/)
    expect(features).toContain('var(--ui-primary)')
    expect(features).toContain('var(--ui-warning)')
  })
})
