import { mockNuxtImport, mountSuspended } from '@nuxt/test-utils/runtime'
import { flushPromises } from '@vue/test-utils'
import { defineComponent, h } from 'vue'
import { afterEach, describe, expect, it, vi } from 'vitest'
import OrganizationReviewContributionNavigation from '../../app/components/organization-review/OrganizationReviewContributionNavigation.vue'
import OrganizationReviewPanelHost from '../../app/components/organization-review/OrganizationReviewPanelHost.vue'

const announcements = vi.hoisted(() => ({ assertive: vi.fn(), polite: vi.fn() }))
mockNuxtImport('useAnnouncer', () => () => announcements)

const wrappers: { unmount(): void }[] = []

afterEach(() => {
  for (const wrapper of wrappers.splice(0)) wrapper.unmount()
  vi.clearAllMocks()
})

describe('OrganizationReviewPanelHost', () => {
  it('loads only the selected literal catalog entry and switches independently', async () => {
    const alphaLoad = vi.fn().mockResolvedValue({ default: panelComponent('Alpha panel content') })
    const betaLoad = vi.fn().mockResolvedValue({ default: panelComponent('Beta panel content') })
    const wrapper = await mountHost(panel('alpha', 'summary', alphaLoad))

    await vi.waitFor(() => expect(wrapper.text()).toContain('Alpha panel content'))
    expect(alphaLoad).toHaveBeenCalledTimes(1)
    expect(betaLoad).not.toHaveBeenCalled()
    expect(announcements.polite).toHaveBeenCalledWith('alpha summary loaded.')

    await wrapper.setProps({ contribution: panel('beta', 'details', betaLoad) })
    await vi.waitFor(() => expect(wrapper.text()).toContain('Beta panel content'))
    expect(alphaLoad).toHaveBeenCalledTimes(1)
    expect(betaLoad).toHaveBeenCalledTimes(1)
  })

  it('retains focus on an initial loader failure and focuses the heading after retry succeeds', async () => {
    const firstLoad = deferred<{ default: ReturnType<typeof panelComponent> }>()
    const load = vi
      .fn()
      .mockReturnValueOnce(firstLoad.promise)
      .mockResolvedValueOnce({ default: panelComponent('Recovered panel') })
    const wrapper = await mountHost(panel('alpha', 'summary', load))
    const existingControl = document.createElement('button')
    document.body.append(existingControl)
    existingControl.focus()
    firstLoad.reject(new Error('broken chunk'))

    await vi.waitFor(() =>
      expect(wrapper.get('[role="alert"]').text()).toContain('could not be loaded'),
    )
    const retry = wrapper.get('button')
    expect(document.activeElement).toBe(existingControl)
    expect(announcements.assertive).toHaveBeenCalledWith('alpha summary could not be loaded.')

    ;(retry.element as HTMLElement).focus()
    await retry.trigger('click')
    await vi.waitFor(() => expect(wrapper.text()).toContain('Recovered panel'))
    expect(load).toHaveBeenCalledTimes(2)
    expect(document.activeElement).toBe(wrapper.get('.organization-review-panel__heading').element)
    existingControl.remove()
  })

  it('consumes explicit focus revisions after loading without refocusing on tab switches', async () => {
    const focus = vi.spyOn(HTMLElement.prototype, 'focus')
    const wrapper = await mountHost(
      panel('alpha', 'summary', vi.fn().mockResolvedValue({ default: panelComponent('Ready') })),
    )
    await vi.waitFor(() => expect(wrapper.text()).toContain('Ready'))
    const heading = wrapper.get('.organization-review-panel__heading')
    expect(document.activeElement).not.toBe(heading.element)

    await wrapper.setProps({ focusRequest: 1 })
    await flushPromises()
    expect(document.activeElement).toBe(heading.element)
    focus.mockClear()

    await wrapper.setProps({
      contribution: panel(
        'beta',
        'details',
        vi.fn().mockResolvedValue({ default: panelComponent('Beta ready') }),
      ),
    })
    await vi.waitFor(() => expect(wrapper.text()).toContain('Beta ready'))
    const betaHeading = wrapper.get('.organization-review-panel__heading')
    expect(focus).not.toHaveBeenCalled()

    await wrapper.setProps({ focusRequest: 2 })
    await flushPromises()
    expect(focus).toHaveBeenCalledTimes(1)
    expect(document.activeElement).toBe(betaHeading.element)
    focus.mockRestore()
  })

  it('preserves a focus request made before the first panel finishes loading', async () => {
    const pending = deferred<{ default: ReturnType<typeof panelComponent> }>()
    const wrapper = await mountHost(
      panel(
        'alpha',
        'summary',
        vi.fn(() => pending.promise),
      ),
      1,
    )
    const heading = wrapper.get('.organization-review-panel__heading')
    expect(document.activeElement).not.toBe(heading.element)

    pending.resolve({ default: panelComponent('Loaded after selection') })

    await vi.waitFor(() => expect(wrapper.text()).toContain('Loaded after selection'))
    expect(document.activeElement).toBe(heading.element)
  })

  it('does not carry a pending focus request into a later tab', async () => {
    const focus = vi.spyOn(HTMLElement.prototype, 'focus')
    const alpha = deferred<{ default: ReturnType<typeof panelComponent> }>()
    const wrapper = await mountHost(
      panel(
        'alpha',
        'summary',
        vi.fn(() => alpha.promise),
      ),
      1,
    )

    await wrapper.setProps({
      contribution: panel(
        'beta',
        'details',
        vi.fn().mockResolvedValue({ default: panelComponent('Beta loaded') }),
      ),
    })
    await vi.waitFor(() => expect(wrapper.text()).toContain('Beta loaded'))
    alpha.resolve({ default: panelComponent('Alpha loaded') })
    await flushPromises()

    expect(focus).not.toHaveBeenCalled()
    focus.mockRestore()
  })

  it('keeps an unrelated panel functional after a render failure', async () => {
    const failing = defineComponent({
      name: 'FailingSyntheticPanel',
      render() {
        throw new Error('render failed')
      },
    })
    const wrapper = await mountHost(
      panel('alpha', 'summary', vi.fn().mockResolvedValue({ default: failing })),
    )
    await vi.waitFor(() =>
      expect(wrapper.get('[role="alert"]').text()).toContain('could not be displayed'),
    )
    await wrapper.get('[role="alert"] button').trigger('click')
    await vi.waitFor(() =>
      expect(wrapper.get('[role="alert"]').text()).toContain('could not be displayed'),
    )

    await wrapper.setProps({
      contribution: panel(
        'beta',
        'details',
        vi.fn().mockResolvedValue({ default: panelComponent('Independent beta panel') }),
      ),
    })
    await vi.waitFor(() => expect(wrapper.text()).toContain('Independent beta panel'))
  })
})

describe('OrganizationReviewContributionNavigation', () => {
  it('does not select a contribution until a reviewer activates one', async () => {
    const alpha = panel('alpha', 'summary', vi.fn())
    const beta = panel('beta', 'details', vi.fn())
    const wrapper = await mountSuspended(OrganizationReviewContributionNavigation, {
      attachTo: document.body,
      props: {
        contributions: [alpha, beta],
      },
      route: false,
    })
    wrappers.push(wrapper)

    await flushPromises()
    expect(wrapper.emitted('update:modelValue')).toBeUndefined()
    expect(wrapper.findAll('[role="tab"]')).toHaveLength(0)
    const choices = wrapper.findAll('.organization-review-contributions__choices button')
    expect(choices).toHaveLength(2)
    expect(wrapper.text()).toContain('Select a permitted panel to load its private data.')

    await choices[0]!.trigger('click')

    expect(wrapper.emitted('update:modelValue')?.at(-1)).toEqual(['alpha/summary'])
  })

  it('exposes labeled tabs with Reka keyboard semantics', async () => {
    const alpha = panel('alpha', 'summary', vi.fn())
    const beta = panel('beta', 'details', vi.fn())
    const wrapper = await mountSuspended(OrganizationReviewContributionNavigation, {
      attachTo: document.body,
      props: {
        contributions: [alpha, beta],
        modelValue: 'alpha/summary',
        'onUpdate:modelValue': (value: string) => wrapper.setProps({ modelValue: value }),
      },
      slots: { default: '<p>Selected panel region</p>' },
      route: false,
    })
    wrappers.push(wrapper)
    const tabs = wrapper.findAll('[role="tab"]')

    expect(tabs).toHaveLength(2)
    expect(tabs[0]!.attributes('aria-selected')).toBe('true')
    ;(tabs[0]!.element as HTMLElement).focus()
    await tabs[0]!.trigger('keydown', { code: 'ArrowRight', key: 'ArrowRight' })
    await flushPromises()
    expect(wrapper.emitted('update:modelValue')?.at(-1)).toEqual(['beta/details'])
    await tabs[1]!.trigger('keydown', { code: 'Home', key: 'Home' })
    await flushPromises()
    expect(wrapper.emitted('update:modelValue')?.at(-1)).toEqual(['alpha/summary'])
    await tabs[0]!.trigger('keydown', { code: 'End', key: 'End' })
    await flushPromises()
    expect(wrapper.emitted('update:modelValue')?.at(-1)).toEqual(['beta/details'])
  })
})

async function mountHost(contribution: ReturnType<typeof panel>, focusRequest = 0) {
  const wrapper = await mountSuspended(OrganizationReviewPanelHost, {
    attachTo: document.body,
    props: {
      contribution,
      focusRequest,
      organizationVersion: 7,
      queryAccess: { authenticated: true, authorized: true, moduleEnabled: true },
      target: {
        kind: 'managed-organization-account',
        managedMemberLifecycleId: 'lifecycle-1',
        userId: '2c4b9cad-46ab-4a47-ac0c-d20c7d507b9c',
      },
    },
    route: false,
  })
  wrappers.push(wrapper)
  return wrapper
}

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (reason: unknown) => void
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise
    reject = rejectPromise
  })
  return { promise, reject, resolve }
}

function panel(moduleId: string, contributionId: string, load: ReturnType<typeof vi.fn>) {
  return {
    moduleId,
    contributionId,
    routeId: `${moduleId}-${contributionId}`,
    routePath: `/api/modules/${moduleId}/${contributionId}`,
    audience: 'hr' as const,
    requiredPermission: `${moduleId}.review`,
    target: 'managed-organization-account' as const,
    panelExport: `./reviewer/${contributionId}`,
    label: `${moduleId} ${contributionId}`,
    description: `Review ${moduleId}.`,
    icon: 'overview' as const,
    order: moduleId === 'alpha' ? 10 : 20,
    load,
  }
}

function panelComponent(content: string) {
  return defineComponent({
    name: 'SyntheticReviewerPanel',
    setup: () => () => h('div', { 'data-testid': 'synthetic-panel' }, content),
  })
}
