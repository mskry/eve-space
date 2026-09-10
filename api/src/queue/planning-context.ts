import type { QueueOutcomeRecorder } from './outcome-recorder.js'
import type { QueueProducer } from './producer.js'

export interface QueuePlanningContext {
  readonly producer: QueueProducer
  readonly outcomes: QueueOutcomeRecorder
  readonly signal?: AbortSignal
}
