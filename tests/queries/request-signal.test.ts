import { describe, expect, it } from 'vitest'
import { createRequestSignal } from '../../app/utils/request-signal'

describe('request signals', () => {
  it('aborts when the caller cancels the request', () => {
    const controller = new AbortController()
    const signal = createRequestSignal(60_000, controller.signal)

    controller.abort()

    expect(signal.aborted).toBe(true)
  })

  it('aborts requests after their deadline', async () => {
    const signal = createRequestSignal(1)

    await new Promise((resolve) => setTimeout(resolve, 5))

    expect(signal.aborted).toBe(true)
  })
})
