export interface PlatformQueryPersistenceInvalidation {
  readonly admissionScopes: readonly string[]
  readonly moduleId: string
}

export type PlatformQueryPersistenceInvalidator = (
  invalidation: PlatformQueryPersistenceInvalidation,
) => void
