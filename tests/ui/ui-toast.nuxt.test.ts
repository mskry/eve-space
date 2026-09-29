import { mountSuspended } from '@nuxt/test-utils/runtime'
import { afterEach, describe, expect, it } from 'vitest'
import { defineComponent, h, nextTick, ref } from 'vue'
import UiProvider from '../../layers/ui/app/components/ui/UiProvider.vue'
import { useToast } from '../../layers/ui/app/composables/useToast'

const mountedWrappers: { unmount: () => void }[] = []

const settle = async () => {
  await nextTick()
  await new Promise((resolve) => setTimeout(resolve, 0))
  await nextTick()
}

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

const findButton = (root: ParentNode, name: string) => {
  const button = [...root.querySelectorAll('button')].find(
    (candidate) => candidate.textContent?.trim() === name,
  )
  if (!button) {
    throw new Error(`button ${name} was not rendered`)
  }
  return button
}

const getButton = (name: string) => findButton(document, name)

const getToastViewport = () => {
  const viewport = document.querySelector<HTMLElement>('.ui-toast-viewport')
  if (!viewport) {
    throw new Error('toast viewport was not rendered')
  }
  return viewport
}

const getCloseControl = () => findButton(getToastViewport(), 'Dismiss')

const createToastHost = () => {
  const ToastControls = defineComponent({
    setup() {
      const { dismissToast, showToast } = useToast()
      const lastKey = ref(0)

      const openFirst = () => {
        lastKey.value = showToast({
          actionHref: '/tickets/first',
          actionLabel: 'View first',
          description: 'First description',
          title: 'First toast',
        })
      }

      const openSecond = () => {
        lastKey.value = showToast({
          actionHref: '/tickets/second',
          actionLabel: 'View second',
          description: 'Second description',
          title: 'Second toast',
        })
      }

      const openWithoutActionLabel = () => {
        lastKey.value = showToast({
          actionHref: '/tickets/default-action',
          title: 'Default action toast',
        })
      }

      const openWithShortDuration = () => {
        lastKey.value = showToast({
          duration: 30,
          title: 'Short duration toast',
        })
      }

      const openPersistent = () => {
        lastKey.value = showToast({
          duration: Number.POSITIVE_INFINITY,
          title: 'Persistent toast',
        })
      }

      return () =>
        h('div', [
          h('button', { onClick: openFirst, type: 'button' }, 'Show first toast'),
          h('button', { onClick: openSecond, type: 'button' }, 'Show second toast'),
          h(
            'button',
            { onClick: () => dismissToast(lastKey.value + 1000), type: 'button' },
            'Dismiss stale key',
          ),
          h(
            'button',
            { onClick: () => dismissToast(lastKey.value), type: 'button' },
            'Dismiss current key',
          ),
          h(
            'button',
            { onClick: openWithoutActionLabel, type: 'button' },
            'Show toast without action label',
          ),
          h(
            'button',
            { onClick: openWithShortDuration, type: 'button' },
            'Show toast with short duration',
          ),
          h('button', { onClick: openPersistent, type: 'button' }, 'Show persistent toast'),
        ])
    },
  })

  return defineComponent({
    setup: () => () => h(UiProvider, null, { default: () => h(ToastControls) }),
  })
}

const mountHost = async () => {
  const wrapper = await mountSuspended(createToastHost(), {
    attachTo: document.body,
    route: false,
  })
  mountedWrappers.push(wrapper)
  return wrapper
}

afterEach(async () => {
  for (const wrapper of mountedWrappers.splice(0)) {
    wrapper.unmount()
  }
  await settle()
  document.body.replaceChildren()
})

describe('UiToast', () => {
  it('shows a toast with its title, description and action link in the provider viewport', async () => {
    await mountHost()
    getButton('Show first toast').click()
    await settle()

    const viewport = getToastViewport()
    expect(viewport.textContent).toContain('First toast')
    expect(viewport.textContent).toContain('First description')
    const action = viewport.querySelector('a')
    expect(action?.getAttribute('href')).toBe('/tickets/first')
    expect(action?.textContent?.trim()).toBe('View first')
  })

  it('replaces the first toast when a second one is shown', async () => {
    await mountHost()
    getButton('Show first toast').click()
    await settle()
    getButton('Show second toast').click()
    await settle()

    const viewport = getToastViewport()
    expect(viewport.textContent).toContain('Second toast')
    expect(viewport.textContent).not.toContain('First toast')
  })

  it('dismisses only when the current key is targeted', async () => {
    await mountHost()
    getButton('Show first toast').click()
    await settle()

    getButton('Dismiss stale key').click()
    await settle()
    expect(getToastViewport().textContent).toContain('First toast')

    getButton('Dismiss current key').click()
    await settle()
    expect(document.querySelector('.ui-toast-root')).toBeNull()
  })

  it('applies the default action label and closes via the rendered close control', async () => {
    await mountHost()
    getButton('Show toast without action label').click()
    await settle()

    const action = getToastViewport().querySelector('a')
    expect(action?.textContent?.trim()).toBe('Open')
    expect(document.querySelector('.ui-toast-root')).not.toBeNull()

    getCloseControl().click()
    await settle()
    expect(document.querySelector('.ui-toast-root')).toBeNull()
  })

  it('auto-dismisses once its duration elapses, but never with an infinite duration', async () => {
    await mountHost()
    getButton('Show toast with short duration').click()
    await settle()
    expect(document.querySelector('.ui-toast-root')).not.toBeNull()

    await wait(150)
    await settle()
    expect(document.querySelector('.ui-toast-root')).toBeNull()

    getButton('Show persistent toast').click()
    await settle()

    await wait(150)
    await settle()
    expect(document.querySelector('.ui-toast-root')).not.toBeNull()
  })
})
