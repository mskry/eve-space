import { mountSuspended } from '@nuxt/test-utils/runtime'
import type { VueWrapper } from '@vue/test-utils'
import { afterEach, expect, it } from 'vitest'
import { nextTick } from 'vue'
import AdminSetupWizard from '../../app/components/admin/SetupWizard.vue'

const mountedWrappers: { unmount: () => void }[] = []

afterEach(() => {
  for (const wrapper of mountedWrappers.splice(0)) wrapper.unmount()
})

async function mountWizard() {
  const wrapper = await mountSuspended(AdminSetupWizard)
  mountedWrappers.push(wrapper)
  return wrapper
}

async function completeOwnerStep(wrapper: VueWrapper) {
  await wrapper.find('input[autocomplete="off"]').setValue('secret-1')
  await wrapper.find('input[autocomplete="username"]').setValue('  owner@corp.eve  ')
  await wrapper.find('input[autocomplete="new-password"]').setValue('orbital-anchor-12')
  await wrapper.find('input[inputmode="numeric"]').setValue(' 98000001 ')
  await nextTick()
}

it('keeps the review step locked until the owner step validates', async () => {
  const wrapper = await mountWizard()

  await wrapper.find('form').trigger('submit')

  expect(wrapper.find('.admin-setup-note').attributes('data-invalid')).toBe('true')
  expect(wrapper.find('#admin-setup-email-hint').attributes('data-invalid')).toBe('true')
  expect(wrapper.findAll('.ui-stepper-trigger')[1]?.attributes('data-disabled')).toBeDefined()
  expect(wrapper.find('.admin-setup-summary').exists()).toBe(false)
})

it('reports password strength for the owner password', async () => {
  const wrapper = await mountWizard()

  await wrapper.find('input[autocomplete="new-password"]').setValue('Orbital-Anchor-12345')
  await nextTick()

  expect(wrapper.find('.admin-setup-strength-label').text()).toBe('STRONG')
  expect(wrapper.find('.admin-setup-strength-bar').attributes('data-score')).toBe('4')
})

it('associates the setup secret label without wrapping its reveal button', async () => {
  const wrapper = await mountWizard()
  const toggle = wrapper.find('.admin-field-reveal button')

  expect(wrapper.find('label[for="admin-setup-secret"]').exists()).toBe(true)
  expect(wrapper.find('#admin-setup-secret').exists()).toBe(true)
  expect(toggle.element.closest('label')).toBeNull()
  expect(toggle.attributes('aria-label')).toBe('Show setup secret')
})

it('summarises the deployment and emits the trimmed setup payload', async () => {
  const wrapper = await mountWizard()
  await completeOwnerStep(wrapper)

  await wrapper.find('form').trigger('submit')

  const summary = wrapper.findAll('.admin-setup-summary dd').map((row) => row.text())
  expect(summary).toContain('owner@corp.eve')
  expect(summary).toContain('Corporation')
  expect(summary).toContain('98000001')

  await wrapper.find('form').trigger('submit')

  expect(wrapper.emitted('submit')).toEqual([
    [
      {
        email: 'owner@corp.eve',
        organizationId: '98000001',
        organizationType: 'corporation',
        password: 'orbital-anchor-12',
        setupSecret: 'secret-1',
      },
    ],
  ])
})
