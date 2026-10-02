import type postgres from 'postgres'
import { waitForRead } from '../read-wait.js'
import { executeCancellableQuery } from '../query-cancellation.js'

export const universeDatabaseTimeoutMilliseconds = 2000
export const universeDatabaseOperationTimeoutMilliseconds = 2500

export type UniverseDatabase = postgres.Sql
export type UniverseQuery = postgres.Sql | postgres.TransactionSql
export type BoundedReadDatabase = Pick<postgres.Sql, 'begin'>
export const executeUniverseQuery = executeCancellableQuery

export const runBoundedReadTransaction = <Result>(
  database: BoundedReadDatabase,
  options: string,
  timeoutError: Error,
  load: (transaction: postgres.TransactionSql, signal: AbortSignal) => Promise<Result>,
  callerSignal?: AbortSignal,
) => {
  callerSignal?.throwIfAborted()
  const controller = new AbortController()
  const signal = callerSignal
    ? AbortSignal.any([callerSignal, controller.signal])
    : controller.signal
  let timer: ReturnType<typeof setTimeout>
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      controller.abort(timeoutError)
      reject(timeoutError)
    }, universeDatabaseOperationTimeoutMilliseconds)
    timer.unref()
  })
  const operation = database.begin(options, async (transaction) => {
    signal.throwIfAborted()
    await executeUniverseQuery(
      transaction.unsafe(
        `set local statement_timeout = '${universeDatabaseTimeoutMilliseconds}ms'`,
      ),
      signal,
    )
    await executeUniverseQuery(
      transaction.unsafe(`set local lock_timeout = '${universeDatabaseTimeoutMilliseconds}ms'`),
      signal,
    )
    return load(transaction, signal)
  })
  return waitForRead(Promise.race([operation, timeout]), signal).finally(() => clearTimeout(timer))
}
