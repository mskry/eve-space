import { mountSuspended } from '@nuxt/test-utils/runtime'
import { afterEach, expect, it } from 'vitest'
import { defineComponent, h, nextTick, ref } from 'vue'
import UiStepper from '../../layers/ui/app/components/ui/UiStepper.vue'

const mountedWrappers: { unmount: () => void }[] = []

afterEach(() => {
  for (const wrapper of mountedWrappers.splice(0)) wrapper.unmount()
})

function createHost() {
  return defineComponent({
    setup() {
      const value = ref(1)
      const steps = [
        { title: 'Deployment owner', value: 1 },
        { disabled: true, title: 'Verify & launch', value: 2 },
      ]

      return () =>
        h('div', [
          h('output', value.value),
          h(UiStepper, {
            label: 'Deployment setup',
            modelValue: value.value,
            steps,
            'onUpdate:modelValue': (next: number) => {
              value.value = next
            },
          }),
        ])
    },
  })
}

async function mountStepper() {
  const wrapper = await mountSuspended(createHost())
  mountedWrappers.push(wrapper)
  return wrapper
}

it('marks the active step and locks the steps that are not reachable', async () => {
  const wrapper = await mountStepper()

  const [owner, launch] = wrapper.findAll('.ui-stepper-item')
  expect(owner?.attributes('data-state')).toBe('active')
  expect(owner?.find('.ui-stepper-indicator').text()).toBe('01')
  expect(owner?.find('.ui-stepper-description').text()).toBe('In progress')
  expect(launch?.attributes('data-state')).toBe('inactive')
  expect(launch?.find('.ui-stepper-description').text()).toBe('Locked')
  expect(launch?.attributes('data-disabled')).toBeDefined()
})

it('ignores activation of a disabled step', async () => {
  const wrapper = await mountStepper()

  await wrapper.findAll('.ui-stepper-trigger')[1]?.trigger('mousedown', { button: 0 })
  await nextTick()

  expect(wrapper.find('output').text()).toBe('1')
})
