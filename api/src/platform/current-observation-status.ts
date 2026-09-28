export const currentObservationDisplayStatus = (
  observationState: 'current' | 'unavailable' | 'never-collected',
  lastFailureClass: string | null,
) => {
  if (observationState === 'current') return 'current' as const
  if (observationState === 'never-collected' && !lastFailureClass) return 'never-collected' as const
  return 'unavailable' as const
}
