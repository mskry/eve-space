import { GraphQLError } from 'graphql'
import { encodeReadValue } from '../read-value.js'

const limitError = () =>
  new GraphQLError('Operation work limit exceeded.', { extensions: { code: 'OPERATION_LIMIT' } })

export class GraphQLRequestState {
  readonly signal: AbortSignal
  private readonly workLimit = new AbortController()
  private invocations = 0
  private active = 0
  private readonly pending: (() => void)[] = []
  private readonly memo = new Map<string, Promise<unknown>>()
  private memoBytes = 0

  constructor(signal: AbortSignal, deadlineMilliseconds = 15_000) {
    this.signal = AbortSignal.any([
      signal,
      this.workLimit.signal,
      AbortSignal.timeout(deadlineMilliseconds),
    ])
  }

  private readonly exceed = () => {
    const error = limitError()
    this.workLimit.abort(error)
    return error
  }

  private readonly acquire = async (): Promise<void> => {
    if (this.active < 4) {
      this.active += 1
      return
    }
    await new Promise<void>((resolve, reject) => {
      const resume = () => {
        this.signal.removeEventListener('abort', abort)
        resolve()
      }
      const abort = () => {
        const index = this.pending.indexOf(resume)
        if (index >= 0) this.pending.splice(index, 1)
        reject(this.signal.reason)
      }
      this.pending.push(resume)
      this.signal.addEventListener('abort', abort, { once: true })
    })
  }

  private readonly release = () => {
    const next = this.pending.shift()
    if (next) next()
    else this.active -= 1
  }

  readonly wait = async <Result>(operation: Promise<Result>): Promise<Result> => {
    return new Promise<Result>((resolve, reject) => {
      const abort = () => reject(this.signal.reason)
      this.signal.addEventListener('abort', abort, { once: true })
      operation.then(resolve, reject).finally(() => this.signal.removeEventListener('abort', abort))
      if (this.signal.aborted) abort()
    })
  }

  readonly run = async <Result>(load: () => Promise<Result>): Promise<Result> => {
    this.signal.throwIfAborted()
    if (++this.invocations > 32) {
      throw this.exceed()
    }
    await this.acquire()
    const operation = Promise.resolve()
      .then(() => {
        this.signal.throwIfAborted()
        return load()
      })
      .finally(this.release)
    return this.wait(operation)
  }

  private readonly retain = <Result>(result: Result): Result => {
    const bytes = encodeReadValue(result).byteLength
    if (this.memoBytes + bytes > 2_097_152) throw this.exceed()
    this.memoBytes += bytes
    return result
  }

  readonly reuse = async <Result>(
    identity: string,
    admitted: () => Promise<void>,
    load: (signal: AbortSignal) => Promise<Result>,
  ): Promise<Result> => {
    this.signal.throwIfAborted()
    await this.wait(admitted())
    this.signal.throwIfAborted()
    let entry = this.memo.get(identity)
    if (!entry) {
      if (this.memo.size >= 32 || identity.length > 4096) throw this.exceed()
      entry = Promise.resolve()
        .then(() => {
          this.signal.throwIfAborted()
          return load(this.signal)
        })
        .then(this.retain)
      this.memo.set(identity, entry)
    }
    // SAFETY: The caller binds each request-local identity to one admitted read and result contract.
    const result = (await this.wait(entry)) as Result
    this.signal.throwIfAborted()
    await this.wait(admitted())
    this.signal.throwIfAborted()
    return result
  }

  readonly read = <Result>(
    identity: string,
    admitted: () => Promise<void>,
    load: (signal: AbortSignal) => Promise<Result>,
  ) =>
    this.reuse(identity, admitted, (signal) =>
      this.run(async () => {
        await admitted()
        return load(signal)
      }),
    )
}
