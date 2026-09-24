export const API_BOOTSTRAP_TIMEOUT_MS = 5000

export function createRequestSignal(timeoutMs: number, signal?: AbortSignal) {
  const timeoutSignal = AbortSignal.timeout(timeoutMs)
  return signal ? AbortSignal.any([signal, timeoutSignal]) : timeoutSignal
}
