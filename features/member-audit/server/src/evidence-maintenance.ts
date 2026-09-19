import type { PlatformResourceMaintenanceContext } from '@eve-space/platform-module-contract/resources'
import type { EvidenceMaintenancePersistence } from './persistence.js'

type EvidencePurgeInput = Parameters<EvidenceMaintenancePersistence['purgeEvidence']>[0]
type WithoutLimit<Input> = Input extends unknown ? Omit<Input, 'limit'> : never
export type EvidenceStore = Exclude<
  EvidencePurgeInput['store'],
  'continuations' | 'staging' | 'promotions'
>
export type EvidenceMaintenanceContext =
  PlatformResourceMaintenanceContext<EvidenceMaintenancePersistence>

export async function maintainEvidence(
  storeOrStores: EvidenceStore | readonly EvidenceStore[],
  context: EvidenceMaintenanceContext,
  purgeRetention: boolean,
) {
  if (purgeRetention && context.purgeRetention) await purgeExpiredEvidence(context)
  const stores = typeof storeOrStores === 'string' ? [storeOrStores] : storeOrStores
  const purges: WithoutLimit<EvidencePurgeInput>[] = []
  for (const store of stores) {
    for (const authority of context.invalidAuthorities)
      purges.push({ mode: 'authority', store, ...authority })
    for (const targetUserId of context.purgeAccountIds)
      purges.push({ mode: 'account', store, targetUserId })
  }
  for (const purge of purges) {
    context.signal?.throwIfAborted()
    // oxlint-disable-next-line no-await-in-loop -- A resource can issue overlapping account and authority purges.
    await purgeAllBatches(context, purge)
  }
}

async function purgeExpiredEvidence(context: EvidenceMaintenanceContext) {
  const now = new Date(context.now)
  if (Number.isNaN(now.getTime())) throw new Error('Evidence maintenance time is invalid')
  const transientCutoff = new Date(now.getTime() - 24 * 60 * 60 * 1_000).toISOString()
  const purges: WithoutLimit<EvidencePurgeInput>[] = []
  for (const store of [
    'wallet-journal',
    'wallet-transactions',
    'mail-headers',
    'mail-contents',
  ] as const)
    purges.push({ mode: 'retention', store, cutoff: context.now })
  for (const store of ['continuations', 'staging', 'promotions'] as const)
    purges.push({ mode: 'retention', store, cutoff: transientCutoff })
  for (const purge of purges) {
    // oxlint-disable-next-line no-await-in-loop -- Retention stores share promotion and staging rows.
    await purgeAllBatches(context, purge)
  }
}

async function purgeAllBatches(
  context: EvidenceMaintenanceContext,
  input: WithoutLimit<EvidencePurgeInput>,
) {
  context.signal?.throwIfAborted()
  const { remaining } = await context.capabilities.persistence.purgeEvidence({
    ...input,
    limit: 1_000,
  } as EvidencePurgeInput)
  if (remaining) await purgeAllBatches(context, input)
}
