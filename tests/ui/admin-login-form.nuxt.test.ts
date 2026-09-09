import { mountSuspended } from '@nuxt/test-utils/runtime'
import { afterEach, expect, it, vi } from 'vitest'
import { nextTick } from 'vue'
import AdminLoginForm from '../../app/components/admin/LoginForm.vue'

const mountedWrappers: { unmount: () => void }[] = []

afterEach(() => {
  for (const wrapper of mountedWrappers.splice(0)) wrapper.unmount()
})

async function mountLoginForm(props: Record<string, unknown> = {}) {
  const wrapper = await mountSuspended(AdminLoginForm, { props })
  mountedWrappers.push(wrapper)
  return wrapper
}

it('holds submission until an owner email and a password are present', async () => {
  const wrapper = await mountLoginForm()

  expect(wrapper.find('button[type="submit"]').attributes('disabled')).toBeDefined()

  await wrapper.find('input[type="email"]').setValue('owner@corp.eve')
  await nextTick()
  expect(wrapper.find('button[type="submit"]').attributes('disabled')).toBeDefined()

  await wrapper.find('input[autocomplete="current-password"]').setValue('orbital-anchor-12')
  await nextTick()
  expect(wrapper.find('button[type="submit"]').attributes('disabled')).toBeUndefined()

  await wrapper.find('form').trigger('submit')
  expect(wrapper.emitted('submit')).toEqual([
    [{ email: 'owner@corp.eve', password: 'orbital-anchor-12' }],
  ])
})

it('reveals the password on request', async () => {
  const wrapper = await mountLoginForm()

  await wrapper.find('.admin-field-reveal button').trigger('click')

  expect(wrapper.find('.admin-field-reveal input').attributes('type')).toBe('text')
  expect(wrapper.find('.admin-field-reveal button').text()).toBe('HIDE')
})

it('warns while caps lock is engaged', async () => {
  const wrapper = await mountLoginForm()
  const field = wrapper.find('input[autocomplete="current-password"]')

  const capsLock = vi.spyOn(KeyboardEvent.prototype, 'getModifierState').mockReturnValue(true)
  await field.trigger('keyup')
  capsLock.mockRestore()

  expect(wrapper.find('.admin-access-caps').text()).toBe('Caps lock is on.')

  await field.trigger('blur')
  expect(wrapper.find('.admin-access-caps').exists()).toBe(false)
})

it('marks the credential fields when the deployment rejects the attempt', async () => {
  const wrapper = await mountLoginForm({ errorMessage: 'Email or password is incorrect.' })

  const error = wrapper.find('.admin-access-error')
  expect(error.attributes('role')).toBe('alert')
  expect(error.text()).toContain('Email or password is incorrect.')
  expect(wrapper.find('input[type="email"]').attributes('aria-invalid')).toBe('true')
  expect(wrapper.find('.admin-field-reveal').attributes('data-invalid')).toBe('true')
})

it('reports progress while the credentials are verified', async () => {
  const wrapper = await mountLoginForm({ submitting: true })

  const submit = wrapper.find('button[type="submit"]')
  expect(submit.text()).toBe('AUTHENTICATING...')
  expect(submit.attributes('disabled')).toBeDefined()
})
