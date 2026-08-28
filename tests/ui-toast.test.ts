import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const readWorkspaceFile = (path: string) => readFileSync(resolve(process.cwd(), path), 'utf8')

describe('UiToast', () => {
  it('composes a controlled toast from Reka UI primitives', () => {
    const component = readWorkspaceFile('layers/ui/app/components/ui/UiToast.vue')

    expect(component).toContain(
      "import { ToastClose, ToastDescription, ToastRoot, ToastTitle } from 'reka-ui'",
    )
    expect(component).toContain('description?: string')
    expect(component).toContain('duration?: number')
    expect(component).toContain('actionHref?: string')
    expect(component).toContain('actionLabel?: string')
    expect(component).toContain('title: string')
    expect(component).toContain("defineModel<boolean>('open', { default: false })")
    expect(component).toContain('<ToastRoot v-model:open="open"')
    expect(component).toContain(':duration="duration"')
    expect(component).toContain('<ToastTitle')
    expect(component).toContain('<ToastDescription v-if="description"')
    expect(component).toContain('<a v-if="actionHref" class="ui-toast-action"')
    expect(component).toContain('<ToastClose')
  })

  it('provides the Reka toast context and one shared viewport', () => {
    const provider = readWorkspaceFile('layers/ui/app/components/ui/UiProvider.vue')

    expect(provider).toContain('ToastProvider')
    expect(provider).toContain('<ToastProvider>')
    expect(provider).toContain('const { toast, toastOpen } = useToast()')
    expect(provider).toContain('<UiToast')
    expect(provider).toContain('<ToastViewport class="ui-toast-viewport" />')
    expect(provider.indexOf('<ToastProvider>')).toBeLessThan(provider.indexOf('<slot />'))
    expect(provider.indexOf('<slot />')).toBeLessThan(provider.indexOf('</ToastProvider>'))
  })

  it('exposes one shared toast state for application consumers', () => {
    const composable = readWorkspaceFile('layers/ui/app/composables/useToast.ts')

    expect(composable).toContain("useState<UiToastState>('ui-toast'")
    expect(composable).toContain('function showToast(options: UiToastOptions)')
    expect(composable).toContain('const key = toast.value.key + 1')
    expect(composable).toContain('duration: options.duration ?? defaultDuration')
    expect(composable).toContain('function dismissToast(key?: number)')
  })

  it('hosts shared confirmation dialogs and scopes controller ownership', () => {
    const provider = readWorkspaceFile('layers/ui/app/components/ui/UiProvider.vue')
    const composable = readWorkspaceFile('layers/ui/app/composables/useConfirmDialog.ts')

    expect(provider).toContain('const confirmDialog = provideConfirmDialog()')
    expect(provider).toContain('<UiConfirmDialog')
    expect(provider).toContain('@confirm="confirmDialog.confirmDialog"')
    expect(composable).toContain('function openConfirmDialog(options: UiConfirmDialogOptions)')
    expect(composable).toContain('const ownedDialogs = new Set<number>()')
    expect(composable).toContain('onScopeDispose(() => {')
  })

  it('styles toast elements only with semantic UI variables', () => {
    const css = readWorkspaceFile('layers/ui/app/assets/css/components.css')
    const toastRules = [...css.matchAll(/\.ui-toast[^{}]*\{([^{}]*)\}/g)]
      .map((match) => match[0])
      .join('\n')
    const variables = [...toastRules.matchAll(/var\((--[^),\s]+)/g)].map((match) => match[1])

    expect(toastRules).not.toBe('')
    expect(variables.length).toBeGreaterThan(0)
    expect(variables.every((variable) => variable.startsWith('--ui-'))).toBe(true)
    expect(toastRules).not.toMatch(/#[\da-f]{3,8}\b|rgba?\(|hsla?\(|\[data-theme=/i)
  })

  it('resolves toast palette tokens under both data-theme values', () => {
    const tokens = readWorkspaceFile('layers/ui/app/assets/css/tokens.css')
    const voidTheme = tokens.match(/\[data-theme='void'\]\s*\{([\s\S]*?)\n\}/)?.[1] ?? ''
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
      expect(voidTheme, `${token} is missing from the void theme`).toContain(`${token}:`)
      expect(highSecTheme, `${token} is missing from the high-sec theme`).toContain(`${token}:`)
    }
  })
})
