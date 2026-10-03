export const API_BOOTSTRAP_TIMEOUT_MS = 5000

export const createRequestSignal = (timeoutMs: number, signal?: AbortSignal) => {
  const deadline = AbortSignal.timeout(timeoutMs)
  return signal ? AbortSignal.any([signal, deadline]) : deadline
}
