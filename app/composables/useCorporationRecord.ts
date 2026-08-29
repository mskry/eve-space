import type { ComputedRef, InjectionKey } from 'vue'
import { inject, provide } from 'vue'
import type { CorporationResponse } from '../queries/corporations'

type Corporation = CorporationResponse['corporation']

interface CorporationRecordContext {
  readonly corporationId: ComputedRef<number | undefined>
  readonly corporation: ComputedRef<Corporation | undefined>
}

const corporationRecordKey: InjectionKey<CorporationRecordContext> = Symbol('corporation-record')

export function provideCorporationRecord(context: CorporationRecordContext) {
  provide(corporationRecordKey, context)
}

export function useCorporationRecord() {
  const context = inject(corporationRecordKey)
  if (!context) throw new Error('Corporation record context is unavailable.')
  return context
}
