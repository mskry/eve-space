import { mount } from '@vue/test-utils'
import {
  computed,
  createSSRApp,
  defineComponent,
  h,
  isReadonly,
  nextTick,
  type DeepReadonly,
  type Ref,
} from 'vue'
import { renderToString } from 'vue/server-renderer'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { FINANCE_CLOCK_SENTINEL, useFinanceClock } from '../../app/composables/useFinanceClock'
import {
  expiresWithinFinanceUrgency,
  formatFinanceCountdown,
  formatFinanceSynced,
  isWithinFinanceRange,
} from '../../app/utils/finance'

afterEach(() => {
  vi.useRealTimers()
})

describe('useFinanceClock', () => {
  it('renders the deterministic sentinel without starting a server timer', async () => {
    const setIntervalSpy = vi.spyOn(globalThis, 'setInterval')
    const App = defineComponent({
      setup() {
        const currentTime = useFinanceClock()
        return () => h('output', String(currentTime.value))
      },
    })

    expect(await renderToString(createSSRApp(App))).toBe(
      `<output>${FINANCE_CLOCK_SENTINEL}</output>`,
    )
    expect(setIntervalSpy).not.toHaveBeenCalled()
    setIntervalSpy.mockRestore()
  })

  it('uses one configurable interval, updates from Date.now, and disposes the timer', async () => {
    vi.useFakeTimers()
    vi.setSystemTime('2026-09-02T12:00:00.000Z')
    let currentTime: DeepReadonly<Ref<number>> | undefined
    let setupValue: number | undefined
    const App = defineComponent({
      setup() {
        currentTime = useFinanceClock(1_000)
        setupValue = currentTime.value
        return () => h('output', String(currentTime?.value))
      },
    })

    const wrapper = mount(App)
    expect(setupValue).toBe(FINANCE_CLOCK_SENTINEL)
    expect(currentTime?.value).toBe(Date.parse('2026-09-02T12:00:00.000Z'))
    expect(isReadonly(currentTime)).toBe(true)
    expect(vi.getTimerCount()).toBe(1)

    await vi.advanceTimersByTimeAsync(1_000)
    expect(currentTime?.value).toBe(Date.parse('2026-09-02T12:00:01.000Z'))
    expect(vi.getTimerCount()).toBe(1)

    wrapper.unmount()
    expect(vi.getTimerCount()).toBe(0)
  })

  it('updates range, urgency, countdown, and synchronization values from the same instant', async () => {
    vi.useFakeTimers()
    const initialTime = Date.parse('2026-09-02T12:00:00.000Z')
    vi.setSystemTime(initialTime)
    const recordDate = new Date(initialTime - 7 * 86_400_000 + 500).toISOString()
    const expiresAt = new Date(initialTime + 1_500).toISOString()
    const validatedAt = new Date(initialTime).toISOString()

    const App = defineComponent({
      setup() {
        const currentTime = useFinanceClock(1_000)
        const inRange = computed(() => isWithinFinanceRange(recordDate, '7D', currentTime.value))
        const urgent = computed(() => expiresWithinFinanceUrgency(expiresAt, currentTime.value))
        const countdown = computed(() => formatFinanceCountdown(expiresAt, currentTime.value))
        const synced = computed(() => formatFinanceSynced(validatedAt, currentTime.value))
        return () =>
          h('output', {
            'data-countdown': countdown.value,
            'data-in-range': inRange.value,
            'data-synced': synced.value,
            'data-urgent': urgent.value,
          })
      },
    })

    const wrapper = mount(App)
    await nextTick()
    expect(wrapper.attributes()).toMatchObject({
      'data-countdown': '0h',
      'data-in-range': 'true',
      'data-synced': 'JUST NOW',
      'data-urgent': 'true',
    })

    await vi.advanceTimersByTimeAsync(2_000)
    expect(wrapper.attributes()).toMatchObject({
      'data-countdown': 'ELAPSED',
      'data-in-range': 'false',
      'data-urgent': 'false',
    })

    await vi.advanceTimersByTimeAsync(58_000)
    expect(wrapper.attributes('data-synced')).toBe('1M AGO')
    wrapper.unmount()
  })
})
