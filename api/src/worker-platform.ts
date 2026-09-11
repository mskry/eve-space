export interface WorkerPlatformCloseResult {
  drained: boolean
  timedOut: boolean
}

export interface WorkerPlatform {
  readonly stopped: Promise<void>
  close(timeoutMs: number): Promise<WorkerPlatformCloseResult>
  forceClose(): void
}
