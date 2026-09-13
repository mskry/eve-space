import { describe, expect, it } from 'vitest'
import { readWorkspaceFile as source } from '../support/read-workspace-file'

const authorization = source('app/components/esi/AuthorizationRequired.vue')
const mailStyles = source('app/assets/css/features/mail.css')

describe('mail stylesheet structural contracts', () => {
  it('keeps shared authorization and mail colors on semantic UI tokens', () => {
    const variables = [...mailStyles.matchAll(/var\((--[^),\s]+)/g)].map((match) => match[1])

    expect(authorization).toContain('var(--ui-border)')
    expect(authorization).toContain('var(--ui-surface)')
    expect(variables.length).toBeGreaterThan(0)
    expect(variables.every((variable) => variable.startsWith('--ui-'))).toBe(true)
    expect(mailStyles).not.toMatch(/#[\da-f]{3,8}\b|rgba?\(|hsla?\(/i)
  })
})
