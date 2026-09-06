import { onMounted, onScopeDispose, readonly, ref } from 'vue'

export const FINANCE_CLOCK_SENTINEL = 0
export const FINANCE_CLOCK_INTERVAL_MILLISECONDS = 30_000

export function useFinanceClock(intervalMilliseconds = FINANCE_CLOCK_INTERVAL_MILLISECONDS) {
  const currentTime = ref(FINANCE_CLOCK_SENTINEL)
  let timer: ReturnType<typeof setInterval> | undefined

  onMounted(() => {
    currentTime.value = Date.now()
    timer = setInterval(() => {
      currentTime.value = Date.now()
    }, intervalMilliseconds)
  })

  onScopeDispose(() => {
    if (timer !== undefined) clearInterval(timer)
  })

  return readonly(currentTime)
}
