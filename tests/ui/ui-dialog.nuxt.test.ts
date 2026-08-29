import { mountSuspended } from '@nuxt/test-utils/runtime'
import { readFileSync } from 'node:fs'
import { resolve as resolvePath } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { defineComponent, h, nextTick, ref, type Component } from 'vue'
import UiDialog from '../../layers/ui/app/components/ui/UiDialog.vue'
import UiProvider from '../../layers/ui/app/components/ui/UiProvider.vue'
import { useConfirmDialog } from '../../layers/ui/app/composables/useConfirmDialog'

const mountedWrappers: { unmount: () => void }[] = []

async function settle() {
  await nextTick()
  await new Promise((resolve) => setTimeout(resolve, 0))
  await nextTick()
}

function getButton(name: string) {
  const button = [...document.querySelectorAll('button')].find(
    (candidate) => candidate.textContent?.trim() === name,
  )
  expect(button, `button ${name} was not rendered`).toBeDefined()
  return button as HTMLButtonElement
}

function createDialogHost() {
  return defineComponent({
    setup() {
      const open = ref(false)

      return () =>
        h('div', [
          h('output', { 'data-open-state': '' }, open.value ? 'open' : 'closed'),
          h(
            UiDialog,
            {
              description: 'Compose and send a message.',
              open: open.value,
              title: 'New message',
              'onUpdate:open': (value: boolean) => {
                open.value = value
              },
            },
            {
              default: () => h('button', { type: 'button' }, 'Primary action'),
              trigger: () => h('button', { type: 'button' }, 'Open composition'),
            },
          ),
        ])
    },
  })
}

async function mountHost(component: Component) {
  const wrapper = await mountSuspended(component, { attachTo: document.body, route: false })
  mountedWrappers.push(wrapper)
  return wrapper
}

afterEach(async () => {
  for (const wrapper of mountedWrappers.splice(0)) wrapper.unmount()
  await settle()
  document.body.replaceChildren()
  document.body.removeAttribute('style')
})

describe('UiDialog', () => {
  it('uses semantic UI variables for its visual treatment', () => {
    const css = readFileSync(
      resolvePath(process.cwd(), 'layers/ui/app/assets/css/components.css'),
      'utf8',
    )
    const dialogRules = [...css.matchAll(/\.ui-dialog[^{}]*\{([^{}]*)\}/g)]
      .map((match) => match[0])
      .join('\n')
    const variables = [...dialogRules.matchAll(/var\((--[^),\s]+)/g)].map((match) => match[1])

    expect(dialogRules).not.toBe('')
    expect(variables.length).toBeGreaterThan(0)
    expect(variables.every((variable) => variable.startsWith('--ui-'))).toBe(true)
    expect(dialogRules).not.toMatch(/#[\da-f]{3,8}\b|rgba?\(|hsla?\(|\[data-theme=/i)
  })

  it('controls open state, moves focus inside, and restores focus when closed', async () => {
    const wrapper = await mountHost(createDialogHost())
    const trigger = getButton('Open composition')
    trigger.focus()
    trigger.click()
    await settle()

    const dialog = document.querySelector<HTMLElement>('[role="dialog"]')
    expect(dialog).not.toBeNull()
    expect(dialog?.textContent).toContain('New message')
    expect(dialog?.textContent).toContain('Compose and send a message.')
    expect(dialog?.contains(document.activeElement)).toBe(true)
    expect(wrapper.get('[data-open-state]').text()).toBe('open')

    getButton('X').click()
    await settle()

    expect(document.querySelector('[role="dialog"]')).toBeNull()
    expect(wrapper.get('[data-open-state]').text()).toBe('closed')
    expect(document.activeElement).toBe(trigger)
  })

  it('dismisses with Escape and an overlay pointer press', async () => {
    const wrapper = await mountHost(createDialogHost())
    const trigger = getButton('Open composition')

    trigger.click()
    await settle()
    document.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, key: 'Escape' }))
    await settle()

    expect(document.querySelector('[role="dialog"]')).toBeNull()
    expect(wrapper.get('[data-open-state]').text()).toBe('closed')
    expect(document.activeElement).toBe(trigger)

    trigger.click()
    await settle()
    document
      .querySelector<HTMLElement>('.ui-dialog-overlay')
      ?.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, button: 0 }))
    await settle()

    expect(document.querySelector('[role="dialog"]')).toBeNull()
    expect(wrapper.get('[data-open-state]').text()).toBe('closed')
    expect(document.activeElement).toBe(trigger)
  })

  it('keeps the composition open while a provider-hosted confirmation is active', async () => {
    const Composition = defineComponent({
      setup() {
        const open = ref(false)
        const { openConfirmDialog } = useConfirmDialog()

        return () =>
          h(
            UiDialog,
            {
              description: 'Compose and send a message.',
              open: open.value,
              title: 'New message',
              'onUpdate:open': (value: boolean) => {
                open.value = value
              },
            },
            {
              default: () =>
                h(
                  'button',
                  {
                    type: 'button',
                    onClick: () =>
                      openConfirmDialog({
                        description: 'The draft will be discarded.',
                        onConfirm: () => {},
                        title: 'Discard draft?',
                      }),
                  },
                  'Discard draft',
                ),
              trigger: () => h('button', { type: 'button' }, 'Open composition'),
            },
          )
      },
    })
    const Host = defineComponent({
      setup: () => () => h(UiProvider, null, { default: () => h(Composition) }),
    })

    await mountHost(Host)
    getButton('Open composition').click()
    await settle()
    const discard = getButton('Discard draft')
    discard.focus()
    discard.click()
    await settle()

    const dialog = document.querySelector<HTMLElement>('[role="dialog"]')
    const confirmation = document.querySelector<HTMLElement>('[role="alertdialog"]')
    expect(dialog).not.toBeNull()
    expect(confirmation).not.toBeNull()
    expect(confirmation?.contains(document.activeElement)).toBe(true)

    document
      .querySelector<HTMLElement>('.ui-confirm-dialog-overlay')
      ?.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, button: 0 }))
    await settle()

    expect(document.querySelector('[role="alertdialog"]')).not.toBeNull()
    expect(document.querySelector('[role="dialog"]')).not.toBeNull()

    getButton('Cancel').click()
    await settle()

    expect(document.querySelector('[role="alertdialog"]')).toBeNull()
    expect(document.querySelector('[role="dialog"]')).not.toBeNull()
    expect(document.activeElement).toBe(discard)
  })
})
