import { Cause, Clock, Effect, Exit } from 'effect'
import type { EsiRequestPermit } from './runtime-ports.js'

const permitOwnershipLostMessage = 'ESI concurrency permit ownership lost'

export interface EsiRequestAttemptOptions<Result> {
  readonly executionSignal?: AbortSignal
  readonly acquirePermit: (signal: AbortSignal) => Promise<EsiRequestPermit>
  readonly createTransport: (options: {
    readonly onResponseBodySettled: () => void
  }) => typeof globalThis.fetch
  readonly attempt: (transport: typeof globalThis.fetch) => Promise<Result>
  readonly clock?: Clock.Clock
}

export async function executeEsiRequestAttempt<Result>(
  options: EsiRequestAttemptOptions<Result>,
): Promise<Result> {
  options.executionSignal?.throwIfAborted()
  let settleAttempt!: () => void
  const attemptSettled = new Promise<void>((resolve) => {
    settleAttempt = resolve
  })
  const lifecycles: Promise<void>[] = []
  const transport: typeof globalThis.fetch = (input, init) => {
    const callerSignal = init?.signal ?? (input instanceof Request ? input.signal : undefined)
    const cancellationSignal = composeSignals(callerSignal, options.executionSignal)
    let resolveResponse!: (response: Response) => void
    let rejectResponse!: (error: unknown) => void
    const response = new Promise<Response>((resolve, reject) => {
      resolveResponse = resolve
      rejectResponse = reject
    })
    const lifecycle = runRequestLifecycle({
      acquirePermit: options.acquirePermit,
      attemptSettled,
      cancellationSignal,
      clock: options.clock,
      createTransport: options.createTransport,
      init,
      input,
      rejectResponse,
      resolveResponse,
    })
    lifecycles.push(lifecycle)
    void lifecycle.catch(() => {})
    return response
  }

  const outcome = await Promise.resolve()
    .then(() => options.attempt(transport))
    .then(
      (value) => ({ kind: 'success' as const, value }),
      (error: unknown) => ({ error, kind: 'failure' as const }),
    )
    .finally(settleAttempt)
  const lifecycleOutcomes = await Promise.allSettled(lifecycles)

  options.executionSignal?.throwIfAborted()
  if (outcome.kind === 'failure') {
    throw outcome.error
  }
  const lifecycleFailure = lifecycleOutcomes.find(
    (candidate): candidate is PromiseRejectedResult => candidate.status === 'rejected',
  )
  if (lifecycleFailure) {
    throw lifecycleFailure.reason
  }
  return outcome.value
}

interface RequestLifecycleOptions {
  readonly acquirePermit: (signal: AbortSignal) => Promise<EsiRequestPermit>
  readonly createTransport: EsiRequestAttemptOptions<unknown>['createTransport']
  readonly input: RequestInfo | URL
  readonly init?: RequestInit
  readonly resolveResponse: (response: Response) => void
  readonly rejectResponse: (error: unknown) => void
  readonly cancellationSignal?: AbortSignal
  readonly attemptSettled: Promise<void>
  readonly clock?: Clock.Clock
}

async function runRequestLifecycle(options: RequestLifecycleOptions): Promise<void> {
  let responseDelivered = false
  let settleBody!: () => void
  const bodySettled = new Promise<void>((resolve) => {
    settleBody = resolve
  })
  const ownershipController = new AbortController()
  const ownershipLost = new DOMException(permitOwnershipLostMessage, 'AbortError')
  const program = Effect.scoped(
    Effect.gen(function* () {
      const ownedPermit = yield* Effect.acquireRelease(
        acquireOwnedPermit(options.acquirePermit),
        (owned) => Effect.promise(() => owned.release()),
        { interruptible: true },
      )
      const requestTransport = yield* Effect.try({
        catch: (error) => error,
        try: () =>
          options.createTransport({
            onResponseBodySettled: settleBody,
          }),
      })
      yield* Effect.forkScoped(renewPermit(ownedPermit.permit, ownershipController, ownershipLost))
      const requestSignal = composeSignals(options.cancellationSignal, ownershipController.signal)
      const response = yield* Effect.uninterruptible(
        Effect.gen(function* () {
          const received = yield* Effect.tryPromise({
            catch: (error) => error,
            try: () =>
              requestTransport(options.input, {
                ...options.init,
                signal: requestSignal,
              }),
          })
          if (!requestSignal?.aborted) {
            return received
          }
          yield* Effect.promise(() => cancelResponseBody(received, requestSignal.reason))
          return yield* Effect.fail(requestSignal.reason)
        }),
      )
      responseDelivered = true
      options.resolveResponse(response)
      yield* Effect.uninterruptible(
        Effect.promise(() => Promise.all([bodySettled, options.attemptSettled]).then(() => {})),
      )
    }),
  )
  const runnable = options.clock
    ? Effect.provideService(program, Clock.Clock, options.clock)
    : program
  const exit = await Effect.runPromiseExit(
    runnable,
    options.cancellationSignal ? { signal: options.cancellationSignal } : undefined,
  )
  if (Exit.isSuccess(exit)) {
    return
  }

  const error = errorFromCause(exit.cause, options.cancellationSignal)
  if (!responseDelivered) {
    options.rejectResponse(error)
  }
  throw error
}

interface OwnedEsiRequestPermit {
  readonly permit: EsiRequestPermit
  release(): Promise<void>
}

function acquireOwnedPermit(
  acquirePermit: (signal: AbortSignal) => Promise<EsiRequestPermit>,
): Effect.Effect<OwnedEsiRequestPermit, unknown> {
  return Effect.callback((resume, signal) => {
    const acquired = Promise.resolve()
      .then(() => acquirePermit(signal))
      .then(ownPermit)
    void acquired.then(
      (permit) => resume(Effect.succeed(permit)),
      (error: unknown) => resume(Effect.fail(error)),
    )

    // Native acquisition may grant after interruption, so cleanup must join its eventual result.
    return Effect.promise(() =>
      acquired.then(
        (permit) => permit.release(),
        () => {},
      ),
    )
  })
}

const renewPermit = Effect.fnUntraced(function* (
  permit: EsiRequestPermit,
  ownershipController: AbortController,
  ownershipLost: DOMException,
) {
  const intervalMilliseconds = Math.floor(permit.ttlMs / 2)
  while (true) {
    yield* Effect.sleep(intervalMilliseconds)
    // Redis commands cannot be cancelled, so interruption waits for an issued renewal to settle.
    const renewal = yield* Effect.exit(
      Effect.uninterruptible(
        Effect.tryPromise({
          catch: (error) => error,
          try: () => permit.renew(),
        }),
      ),
    )
    if (Exit.isSuccess(renewal) && renewal.value) {
      continue
    }
    yield* Effect.sync(() => ownershipController.abort(ownershipLost))
    return
  }
})

function ownPermit(permit: EsiRequestPermit): OwnedEsiRequestPermit {
  let releasePromise: Promise<void> | undefined
  return {
    permit,
    release() {
      releasePromise ??= Promise.resolve()
        .then(() => permit.release())
        .catch(() => {})
      return releasePromise
    },
  }
}

async function cancelResponseBody(response: Response, reason: unknown) {
  await response.body?.cancel(reason).catch(() => {})
}

// Preserve the original rejection identity; an abort reason or Effect defect need not be an Error.
function errorFromCause(cause: Cause.Cause<unknown>, signal?: AbortSignal): unknown {
  if (signal?.aborted) {
    return signal.reason
  }
  for (const reason of cause.reasons) {
    if (Cause.isFailReason(reason)) return reason.error
  }
  for (const reason of cause.reasons) {
    if (Cause.isDieReason(reason)) return reason.defect
  }
  return Cause.squash(cause)
}

function composeSignals(...signals: Array<AbortSignal | undefined>) {
  const present = signals.filter((signal): signal is AbortSignal => signal !== undefined)
  if (present.length === 0) {
    return
  }
  return present.length === 1 ? present[0] : AbortSignal.any(present)
}
