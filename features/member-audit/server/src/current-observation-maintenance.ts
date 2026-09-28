import type { PlatformResourceMaintenanceContext } from '@eve-space/platform-module-contract/resources'
import type { CurrentObservationMaintenancePersistence } from './persistence.js'
import { purgeInBatches } from './purge-batches.js'

type PurgeInput = Parameters<CurrentObservationMaintenancePersistence['purgeCurrentObservation']>[0]
type WithoutLimit<Input> = Input extends unknown ? Omit<Input, 'limit'> : never
type ObservationStore = 'current-ship' | 'current-location'

export const maintainCurrentObservation = async (
  store: ObservationStore,
  context: PlatformResourceMaintenanceContext<CurrentObservationMaintenancePersistence>,
) => {
  const purge = (input: WithoutLimit<PurgeInput>) =>
    purgeInBatches<PurgeInput>(
      input,
      context.capabilities.persistence.purgeCurrentObservation,
      context.signal,
    )
  if (context.purgeRetention) {
    await purge({ cutoff: context.now, mode: 'retention', store })
  }
  for (const authority of context.invalidAuthorities) {
    // oxlint-disable-next-line no-await-in-loop -- Purges for one store share the same snapshot rows.
    await purge({ ...authority, mode: 'authority', store })
  }
  for (const targetUserId of context.purgeAccountIds) {
    // oxlint-disable-next-line no-await-in-loop -- Account and authority purges may overlap.
    await purge({ mode: 'account', store, targetUserId })
  }
}
