import {
  definePlatformInventoryProvider,
  type PlatformAdmittedCorporationInventory,
  type PlatformInventoryView,
  type PlatformPersonalInventoryCapabilities,
  type PlatformCorporationInventoryCapabilities,
  type PlatformInventoryQuantity,
} from '@eve-space/platform-module-contract/inventory'
import type { PlatformGraphQLReadCapabilities } from '@eve-space/platform-module-contract/graphql'

declare const view: PlatformInventoryView<'corporation'>
declare const admission: PlatformAdmittedCorporationInventory
declare const personal: PlatformPersonalInventoryCapabilities
declare const corporation: PlatformCorporationInventoryCapabilities
declare const graphql: PlatformGraphQLReadCapabilities<readonly [], object, 'personal'>

const provider = definePlatformInventoryProvider<{
  readProjection(input: { fingerprint: string }): Promise<PlatformInventoryView<'corporation'>>
}>(({ persistence }) => async (scope) => {
  // @ts-expect-error Providers receive only their declared read operations.
  void persistence.writeProjection
  return persistence.readProjection({ fingerprint: scope.fingerprint })
})

const read = { kind: 'groups', first: 10 } as const
const boundProvider = provider({ persistence: {}, signal: new AbortController().signal })
void boundProvider(admission, read)
const forgedAdmission = {
  scope: 'corporation',
  actorUserId: 'actor',
  corporationId: 1,
  organizationVersion: 1,
  authorizationRevision: 1,
  fingerprint: 'forged',
  subjects: [],
} as const
// @ts-expect-error Caller-supplied unbounded subjects are not core admission.
void boundProvider(forgedAdmission, read)
// @ts-expect-error A provider cannot return a raw snapshot or an incompatible DTO.
definePlatformInventoryProvider(() => async () => ({ version: 2, assets: [] }))
// @ts-expect-error Consumers have no provider persistence capability.
void corporation.persistence
// @ts-expect-error Consumers cannot select a provider or dispatch arbitrary operations.
void personal.dispatch('member-audit', 'read-assets')
// @ts-expect-error The personal GraphQL capability cannot read corporation inventory.
void graphql.inventory.corporationInventory(read)
// @ts-expect-error Inventory selection cannot widen the bound subject set.
void personal.personalInventory({ ...read, characterIds: [1, 2] })
// @ts-expect-error Exact quantities cannot use floating point numbers.
const invalidQuantity: PlatformInventoryQuantity = 1.5
const quantity: PlatformInventoryQuantity = '9007199254740993'
void [view, invalidQuantity, quantity]
