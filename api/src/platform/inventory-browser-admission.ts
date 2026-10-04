import type { PlatformInstalledGraphQLContribution } from '@eve-space/platform-module-contract/graphql'
import type { SessionAccount } from '../auth/session-store.js'
import { immediateReadWork, type ReadAdmissionWork } from '../auth/read-work.js'
import { ReadAdmissionError } from '../auth/read-policy.js'
import { installedGraphQLContributions } from '../generated/platform/installed-module-graphql.js'
import { admitOrganizationRead } from '../organization/read-admission.js'
import { loadOrganizationSessionContext } from '../organization/session-context.js'
import { listInventoryCorporations } from '../organization/inventory-corporations.js'
import { admitInventory, createInventoryReadGuard } from './inventory-admission.js'
import { moduleReadEnablementDenial } from './read-enablement.js'
import { installedInventoryProviders } from '../generated/platform/installed-module-inventory-providers.js'

export type InventoryBrowserSelection =
  | { readonly scope: 'personal'; readonly characterIds?: readonly number[] }
  | { readonly scope: 'corporation'; readonly corporationId: number }

const contributions: readonly PlatformInstalledGraphQLContribution[] = installedGraphQLContributions
const contribution = contributions.find(
  (item) => item.moduleId === 'trading' && item.id === 'inventory',
)

const corporationDeclaration = () => {
  const read = contribution?.reads.find(
    (item) => item.strategy === 'reviewer-corporation-inventory',
  )
  if (!read?.organization || !contribution) throw new Error('Inventory contribution unavailable')
  return {
    ...read.organization,
    moduleId: contribution.moduleId,
    publisherPackage: contribution.publisherPackage,
  }
}

export const admitBrowserInventory = async (
  session: SessionAccount | null,
  selection: InventoryBrowserSelection,
  liveSession: () => Promise<SessionAccount | null>,
  work: ReadAdmissionWork = immediateReadWork,
) => {
  const request =
    selection.scope === 'personal'
      ? selection
      : { ...selection, declaration: corporationDeclaration() }
  const result = await admitInventory(session, request, work)
  if (!result.admitted) return result
  const guard = createInventoryReadGuard(result.binding, liveSession, work)
  try {
    await guard.assertCurrent()
  } catch (error) {
    if (error instanceof ReadAdmissionError) return error.denial
    throw error
  }
  return {
    admitted: true as const,
    ownerId: result.binding.actorUserId,
    fingerprint: result.binding.fingerprint,
    validForMilliseconds: 60_000,
  }
}

export const browserInventoryCorporations = async (
  session: SessionAccount | null,
  liveSession: () => Promise<SessionAccount | null>,
) => {
  const disabled =
    (await moduleReadEnablementDenial('trading')) ??
    (await moduleReadEnablementDenial('member-audit', 'assets'))
  if (disabled) return disabled
  if (
    !installedInventoryProviders.some(
      (provider) => provider.moduleId === 'member-audit' && provider.id === 'assets-inventory',
    )
  )
    return {
      admitted: false as const,
      status: 404 as const,
      body: { code: 'INVENTORY_SCOPE_DENIED', message: 'Corporation inventory is unavailable.' },
    }
  const declaration = corporationDeclaration()
  const viewer = session ? await loadOrganizationSessionContext(session.userId) : null
  const admission = await admitOrganizationRead(session, viewer, declaration, true)
  if (!admission.admitted) return admission
  const corporations = await listInventoryCorporations(admission.organization.organizationVersion)
  if (!corporations)
    return {
      admitted: false as const,
      status: 409 as const,
      body: {
        code: 'INVENTORY_RESTART_REQUIRED',
        message: 'Corporation selection is unavailable; retry admission.',
      },
    }
  const latestSession = await liveSession()
  const latest = await admitOrganizationRead(
    latestSession?.userId === session?.userId ? latestSession : null,
    await loadOrganizationSessionContext(session!.userId),
    declaration,
    true,
  )
  if (!latest.admitted) return latest
  if (latest.organization.organizationVersion !== admission.organization.organizationVersion)
    return {
      admitted: false as const,
      status: 409 as const,
      body: { code: 'INVENTORY_AUTHORIZATION_CHANGED', message: 'Organization authority changed.' },
    }
  return { admitted: true as const, corporations }
}
