import {
  defineQueryOptions,
  type DefineQueryOptions,
  type DefineQueryOptionsTagged,
  type EntryKey,
  type QueryMeta,
} from '@pinia/colada'
import type { PlatformAuthorizationStrategy } from '@eve-space/platform-module-contract/server'
import type { PlatformQueryAdmissionScopeDescriptor } from '@eve-space/platform-module-contract/nuxt'

export const ESI_QUERY_RETENTION_MS = 24 * 60 * 60_000

export type EsiPersistence =
  | { readonly kind: 'none' }
  | { readonly kind: 'public-esi' }
  | { readonly kind: 'character-esi'; readonly characterId: number }
  | { readonly kind: 'organization-esi'; readonly admissionScope: string }

export type PlatformEsiPersistenceIntent =
  | { readonly kind: 'none' }
  | { readonly kind: 'organization-esi' }

type ClassifiedQueryOptions<TData, TError, TDataInitial extends TData | undefined> = Omit<
  DefineQueryOptions<TData, TError, TDataInitial>,
  'gcTime' | 'meta'
> & {
  readonly esiPersistence: EsiPersistence
  readonly gcTime?: number
  readonly meta?: Omit<QueryMeta, 'esiPersistence'>
}

export function defineEsiQueryOptions<
  Params,
  TData,
  TError = Error,
  TDataInitial extends TData | undefined = undefined,
>(
  setupOptions: (params: Params) => ClassifiedQueryOptions<TData, TError, TDataInitial>,
): (params: Params) => DefineQueryOptionsTagged<TData, TError, TDataInitial> {
  return defineQueryOptions((params: Params) => {
    const { esiPersistence, gcTime, meta, ...options } = setupOptions(params)
    return {
      ...options,
      gcTime: esiPersistence.kind === 'none' ? gcTime : ESI_QUERY_RETENTION_MS,
      meta: { ...meta, esiPersistence },
    }
  })
}

export function characterEsiPersistence(characterId: number): EsiPersistence {
  return { kind: 'character-esi', characterId }
}

export function organizationEsiPersistence(admissionScope: string): EsiPersistence {
  return { kind: 'organization-esi', admissionScope }
}

export function resolvePlatformEsiPersistence(
  scopes: readonly (PlatformQueryAdmissionScopeDescriptor & { readonly moduleId: string })[],
  moduleId: string,
  routeId: string,
  authorization: PlatformAuthorizationStrategy,
): EsiPersistence {
  const scope = scopes.find(
    (candidate) =>
      candidate.moduleId === moduleId &&
      candidate.routeId === routeId &&
      candidate.authorization === authorization,
  )
  return scope && authorization === 'authenticated-session'
    ? organizationEsiPersistence(scope.admissionScope)
    : { kind: 'none' }
}

export function isEsiPersistence(value: unknown): value is EsiPersistence {
  if (!isRecord(value)) return false
  if (value.kind === 'none' || value.kind === 'public-esi') return true
  if (value.kind === 'character-esi') return isPositiveInteger(value.characterId)
  return (
    value.kind === 'organization-esi' &&
    typeof value.admissionScope === 'string' &&
    !!value.admissionScope
  )
}

export function isEsiPersistenceEligible(
  value: unknown,
): value is Exclude<EsiPersistence, { kind: 'none' }> {
  return isEsiPersistence(value) && value.kind !== 'none'
}

export function isEsiPersistenceCoherent(key: EntryKey, persistence: EsiPersistence) {
  if (persistence.kind === 'none') return true
  if (persistence.kind === 'public-esi') return key[0] === 'public'
  if (persistence.kind === 'character-esi')
    return key[0] === 'private' && key[1] === 'characters' && key[2] === persistence.characterId
  if (key[0] !== 'private' || key[1] !== 'organization') return false
  const moduleIndex = key.indexOf('modules')
  const expectedOwner = moduleIndex < 0 ? 'core' : key[moduleIndex + 1]
  return (
    typeof expectedOwner === 'string' &&
    organizationAdmissionScopeOwner(persistence.admissionScope) === expectedOwner
  )
}

function organizationAdmissionScopeOwner(admissionScope: string) {
  const parts = admissionScope.split(':')
  return parts[0] === 'organization' && parts[1] === 'v1' ? parts[2] : undefined
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isPositiveInteger(value: unknown) {
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0
}
