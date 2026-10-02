interface PendingRead {
  readonly controller: AbortController
  readonly promise: Promise<unknown>
  waiters: number
}

export class EsiReadWaiters {
  private readonly pending = new Map<string, PendingRead>()

  private readonly create = <Result>(
    key: string,
    load: (signal: AbortSignal) => Promise<Result>,
  ) => {
    const controller = new AbortController()
    const entry: PendingRead = {
      controller,
      waiters: 0,
      promise: Promise.resolve()
        .then(() => {
          controller.signal.throwIfAborted()
          return load(controller.signal)
        })
        .finally(() => {
          if (this.pending.get(key) === entry) this.pending.delete(key)
        }),
    }
    this.pending.set(key, entry)
    return entry
  }

  readonly read = <Result>(
    key: string,
    signal: AbortSignal | undefined,
    load: (signal: AbortSignal) => Promise<Result>,
  ): Promise<Result> => {
    signal?.throwIfAborted()
    const current = this.pending.get(key)
    const entry = current?.controller.signal.aborted
      ? this.create(key, load)
      : (current ?? this.create(key, load))
    entry.waiters += 1
    return new Promise<Result>((resolve, reject) => {
      let settled = false
      const finish = (release: () => void, canceled = false) => {
        if (settled) return
        settled = true
        signal?.removeEventListener('abort', abort)
        entry.waiters -= 1
        if (canceled && entry.waiters === 0) entry.controller.abort(signal?.reason)
        release()
      }
      const abort = () => finish(() => reject(signal?.reason), true)
      signal?.addEventListener('abort', abort, { once: true })
      entry.promise.then(
        // SAFETY: Keys include the registered representation, source identity and authorization generation.
        (value) => finish(() => resolve(value as Result)),
        (error) => finish(() => reject(error)),
      )
      if (signal?.aborted) abort()
    })
  }
}
