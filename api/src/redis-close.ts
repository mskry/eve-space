export interface ClosableRedisConnection {
  readonly status: string
  disconnect(): void
  quit(): Promise<unknown>
}

export async function closeRedisConnection(
  connection: ClosableRedisConnection,
  timeoutMs?: number,
): Promise<void> {
  if (connection.status === 'end') return
  if (connection.status === 'wait' || (timeoutMs !== undefined && timeoutMs <= 0)) {
    connection.disconnect()
    return
  }

  let timer: ReturnType<typeof setTimeout> | undefined
  const quit = connection.quit().then(
    () => true,
    () => false,
  )
  const closed =
    timeoutMs === undefined
      ? await quit
      : await Promise.race([
          quit,
          new Promise<false>((resolve) => {
            timer = setTimeout(resolve, timeoutMs, false)
          }),
        ])
  clearTimeout(timer)
  if (!closed) connection.disconnect()
}
