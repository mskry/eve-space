import { selectDueDerivedDirectorCharacters } from '../organization/derived-authority.js'
import type { QueuePlanningContext } from './planning-context.js'

export async function runDerivedAuthorityPlanner(context: QueuePlanningContext) {
  const { producer, signal } = context
  signal?.throwIfAborted()
  const due = await selectDueDerivedDirectorCharacters()
  signal?.throwIfAborted()
  let planned = 0
  for (const candidate of due) {
    signal?.throwIfAborted()
    // oxlint-disable-next-line no-await-in-loop
    const admission = await producer.enqueue(
      { name: 'derived-authority', payload: candidate, source: 'planner' },
      { signal },
    )
    if (admission.status === 'rejected') {
      if (admission.reason === 'coalesced') continue
      return { planned, reason: admission.reason }
    }
    planned += 1
  }
  return { planned, reason: planned === 0 ? ('idle' as const) : ('scheduled' as const) }
}
