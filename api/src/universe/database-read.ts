import type postgres from 'postgres'

export const universeDatabaseTimeoutMilliseconds = 2_000
export const universeDatabaseOperationTimeoutMilliseconds = 2_500

export type UniverseDatabase = postgres.Sql
export type UniverseQuery = postgres.Sql | postgres.TransactionSql

export function runBoundedReadTransaction<Result>(
  database: UniverseDatabase,
  options: string,
  timeoutError: Error,
  load: (transaction: postgres.TransactionSql, signal: AbortSignal) => Promise<Result>,
) {
  const controller = new AbortController()
  let timer: ReturnType<typeof setTimeout>
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      controller.abort(timeoutError)
      reject(timeoutError)
    }, universeDatabaseOperationTimeoutMilliseconds)
    timer.unref()
  })
  const operation = database.begin(options, async (transaction) => {
    controller.signal.throwIfAborted()
    await executeUniverseQuery(
      transaction.unsafe(
        `set local statement_timeout = '${universeDatabaseTimeoutMilliseconds}ms'`,
      ),
      controller.signal,
    )
    await executeUniverseQuery(
      transaction.unsafe(`set local lock_timeout = '${universeDatabaseTimeoutMilliseconds}ms'`),
      controller.signal,
    )
    return load(transaction, controller.signal)
  })
  return Promise.race([operation, timeout]).finally(() => clearTimeout(timer))
}

export async function executeUniverseQuery<Result>(
  query: Promise<Result> & { cancel(): void },
  signal: AbortSignal,
) {
  signal.throwIfAborted()
  const cancel = () => query.cancel()
  signal.addEventListener('abort', cancel, { once: true })
  try {
    return await query
  } finally {
    signal.removeEventListener('abort', cancel)
  }
}
