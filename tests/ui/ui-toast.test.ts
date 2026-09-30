import { describe, expect, it } from 'vitest'
import { readWorkspaceFile } from '../support/read-workspace-file'

describe('UiToast', () => {
  it('styles toast elements only with semantic UI and Reka gesture variables', () => {
    const css = readWorkspaceFile('layers/ui/app/assets/css/toast.css')
    const toastRules = [...css.matchAll(/\.ui-toast[^{}]*\{([^{}]*)\}/g)]
      .map((match) => match[0])
      .join('\n')
    const variables = [...toastRules.matchAll(/var\((--[^),\s]+)/g)].map((match) => match[1])

    expect(toastRules).not.toBe('')
    expect(variables.length).toBeGreaterThan(0)
    const gestureVariables = new Set(['--reka-toast-swipe-move-x', '--reka-toast-swipe-end-x'])
    expect(
      variables.every((variable) => variable.startsWith('--ui-') || gestureVariables.has(variable)),
    ).toBe(true)
    expect(toastRules).not.toMatch(/#[\da-f]{3,8}\b|rgba?\(|hsla?\(|\[data-theme=/i)
  })

  it('resolves toast palette tokens under every data-theme value', () => {
    const tokens = readWorkspaceFile('layers/ui/app/assets/css/tokens.css')
    const gallenteTheme = tokens.match(/\[data-theme='gallente'\]\s*\{([\s\S]*?)\n\}/)?.[1] ?? ''
    const amarrTheme = tokens.match(/\[data-theme='amarr'\]\s*\{([\s\S]*?)\n\}/)?.[1] ?? ''
    const caldariTheme = tokens.match(/\[data-theme='caldari'\]\s*\{([\s\S]*?)\n\}/)?.[1] ?? ''
    const minmatarTheme = tokens.match(/\[data-theme='minmatar'\]\s*\{([\s\S]*?)\n\}/)?.[1] ?? ''
    const highSecTheme = tokens.match(/\[data-theme='high-sec'\]\s*\{([\s\S]*?)\n\}/)?.[1] ?? ''
    const paletteTokens = [
      '--ui-border',
      '--ui-border-strong',
      '--ui-control',
      '--ui-primary',
      '--ui-shadow',
      '--ui-surface-raised',
      '--ui-surface-solid',
      '--ui-text',
      '--ui-text-muted',
    ]

    for (const token of paletteTokens) {
      expect(gallenteTheme, `${token} is missing from the gallente theme`).toContain(`${token}:`)
      expect(amarrTheme, `${token} is missing from the amarr theme`).toContain(`${token}:`)
      expect(caldariTheme, `${token} is missing from the caldari theme`).toContain(`${token}:`)
      expect(minmatarTheme, `${token} is missing from the minmatar theme`).toContain(`${token}:`)
      expect(highSecTheme, `${token} is missing from the high-sec theme`).toContain(`${token}:`)
    }
  })
})
