type ShutdownSignal = 'SIGINT' | 'SIGTERM'

export function installShutdownSignalHandlers(requestShutdown: () => void): () => void {
  const signals: ShutdownSignal[] = ['SIGINT', 'SIGTERM']
  for (const signal of signals) process.on(signal, requestShutdown)

  return () => {
    for (const signal of signals) process.off(signal, requestShutdown)
  }
}
