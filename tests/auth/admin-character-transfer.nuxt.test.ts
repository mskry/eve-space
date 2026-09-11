import { mockNuxtImport, mountSuspended } from '@nuxt/test-utils/runtime'
import { flushPromises } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import CharacterTransferApprovals from '../../app/components/admin/CharacterTransferApprovals.vue'

const { approvalRequest, createApiClient, inspectionRequest, previewRequest, revocationRequest } =
  vi.hoisted(() => ({
    approvalRequest: vi.fn(),
    createApiClient: vi.fn(),
    inspectionRequest: vi.fn(),
    previewRequest: vi.fn(),
    revocationRequest: vi.fn(),
  }))

mockNuxtImport('createApiClient', () => createApiClient)

const previewId = '688e2f93-b245-40af-807a-798550540e47'
const approvalId = '66503848-72b8-4fa3-8af5-de056001a37e'
const transferLink = `http://localhost:3000/transfer#approval=${approvalId}&secret=transfer-secret`
const character = { characterId: 1_404_328_063, name: 'Moving Pilot' }
const destinationMain = { characterId: 2_112_625_428, name: 'Destination Pilot' }
const expiresAt = '2026-09-11T12:15:00.000Z'
const mountedWrappers: { unmount: () => void }[] = []

beforeEach(() => {
  createApiClient.mockReturnValue({
    api: {
      admin: {
        'character-transfer-approvals': {
          preview: { $post: previewRequest },
          $post: approvalRequest,
          ':approvalId': {
            $get: inspectionRequest,
            revoke: { $post: revocationRequest },
          },
        },
      },
    },
  })
})

afterEach(() => {
  for (const wrapper of mountedWrappers.splice(0)) wrapper.unmount()
  vi.clearAllMocks()
  vi.unstubAllGlobals()
})

describe('administrator character transfer workflow', () => {
  it('previews, approves, copies, and invalidates an exact transfer selection', async () => {
    const hostileReason = '<img src=x onerror="globalThis.compromised=true">'
    const writeText = vi.fn().mockResolvedValue(undefined)
    vi.stubGlobal('navigator', { clipboard: { writeText } })
    previewRequest.mockResolvedValue(
      response({
        preview: eligiblePreview(),
      }),
    )
    approvalRequest.mockResolvedValue(
      response(
        {
          approval: pendingApproval(hostileReason),
          transferLink,
        },
        201,
      ),
    )
    const wrapper = await mountWorkflow()

    const characterInputs = wrapper.findAll('input[type="number"]')
    await characterInputs[0]!.setValue(String(character.characterId))
    await characterInputs[1]!.setValue(String(destinationMain.characterId))
    await wrapper.get('.admin-transfer-reason textarea').setValue(hostileReason)
    expect(wrapper.get('.admin-transfer-reason small').text()).toBe(
      `${hostileReason.length} / 1000`,
    )
    await wrapper.get('.admin-transfer-form').trigger('submit')
    await settle()

    expect(previewRequest).toHaveBeenCalledWith({
      json: {
        characterId: character.characterId,
        destinationMainCharacterId: destinationMain.characterId,
        reason: hostileReason,
      },
    })
    expect(wrapper.text()).toContain('Preview ready. Confirm the immutable transfer details')
    expect(wrapper.text()).toContain('Moving Pilot')
    expect(wrapper.text()).toContain('Destination Pilot')
    expect(wrapper.text()).toContain('Source character count: 2')

    await button(wrapper, 'CREATE APPROVAL').trigger('click')
    await settle()

    expect(approvalRequest).toHaveBeenCalledWith({ json: { previewId } })
    expect(wrapper.text()).toContain(hostileReason)
    expect(wrapper.find('.admin-transfer-approval img').exists()).toBe(false)
    expect((wrapper.get('#transfer-link').element as HTMLInputElement).value).toBe(transferLink)

    await button(wrapper, 'COPY LINK').trigger('click')
    await settle()
    expect(writeText).toHaveBeenCalledWith(transferLink)
    expect(wrapper.text()).toContain('Transfer link copied.')

    writeText.mockRejectedValueOnce(new Error('Clipboard unavailable'))
    await button(wrapper, 'COPY LINK').trigger('click')
    await settle()
    expect(wrapper.text()).toContain('Select and copy it manually.')

    await characterInputs[0]!.setValue('1404328064')
    expect(wrapper.find('.admin-transfer-result').exists()).toBe(false)
  })

  it.each([
    ['main-character', 'Select another source main character'],
    ['authority-evidence', 'Remove active organization-owner authority'],
    ['corporation-source', 'Replace or revoke the active corporation data source'],
    ['destination-main', 'current main-character ID'],
    ['same-account', 'already belong to the same account'],
    ['unavailable', 'transfer identities are unavailable'],
  ] as const)('renders the %s blocker as actionable text', async (blocker, guidance) => {
    previewRequest.mockResolvedValue(
      response({
        preview: {
          eligible: false,
          blocker,
          character,
          destinationMain,
          sourceCharacterCount: 2,
        },
      }),
    )
    const wrapper = await mountWorkflow()

    await completePreviewForm(wrapper)

    expect(wrapper.text()).toContain(guidance)
    expect(wrapper.find('button[type="button"]').exists()).toBe(false)
  })

  it('inspects audit history and revokes a pending approval', async () => {
    const approval = pendingApproval('Repair split account')
    inspectionRequest.mockResolvedValue(
      response({
        approval,
        audit: [
          {
            action: 'created',
            occurredAt: '2026-09-11T12:00:00.000Z',
            reason: 'Repair split account',
            outcome: 'created',
          },
        ],
      }),
    )
    revocationRequest.mockResolvedValue(
      response({
        approval: {
          ...approval,
          status: 'revoked',
          revokedAt: '2026-09-11T12:04:00.000Z',
          revocationReason: 'Destination changed',
        },
      }),
    )
    const wrapper = await mountWorkflow()

    await wrapper.get('#transfer-approval-id').setValue(approvalId)
    await wrapper.get('.admin-transfer-status').trigger('submit')
    await settle()

    expect(inspectionRequest).toHaveBeenCalledWith({ param: { approvalId } })
    expect(wrapper.get('[data-status="pending"]').text()).toBe('PENDING')
    expect(wrapper.get('[aria-label="Approval history"]').text()).toContain('CREATED')
    expect(wrapper.text()).toContain('Approval status refreshed.')

    await wrapper.get('#transfer-revocation-reason').setValue('Destination changed')
    await wrapper.get('.admin-transfer-revoke').trigger('submit')
    await settle()

    expect(revocationRequest).toHaveBeenCalledWith({
      param: { approvalId },
      json: { reason: 'Destination changed' },
    })
    expect(wrapper.get('[data-status="revoked"]').text()).toBe('REVOKED')
    expect(wrapper.find('.admin-transfer-revoke').exists()).toBe(false)
    expect(wrapper.find('[aria-label="Approval history"]').exists()).toBe(false)
    expect(wrapper.text()).toContain('Transfer approval revoked.')
  })

  it('surfaces API errors without exposing an approval result', async () => {
    previewRequest.mockResolvedValue(
      response({ code: 'INVALID_INPUT', message: 'Transfer preview was rejected.' }, 400),
    )
    const wrapper = await mountWorkflow()

    await completePreviewForm(wrapper)

    expect(wrapper.get('[role="alert"]').text()).toBe('Transfer preview was rejected.')
    expect(wrapper.find('.admin-transfer-result').exists()).toBe(false)
  })
})

async function mountWorkflow() {
  const wrapper = await mountSuspended(CharacterTransferApprovals, { route: false })
  mountedWrappers.push(wrapper)
  return wrapper
}

async function completePreviewForm(wrapper: Awaited<ReturnType<typeof mountWorkflow>>) {
  const characterInputs = wrapper.findAll('input[type="number"]')
  await characterInputs[0]!.setValue(String(character.characterId))
  await characterInputs[1]!.setValue(String(destinationMain.characterId))
  await wrapper.get('.admin-transfer-reason textarea').setValue('Repair split account')
  await wrapper.get('.admin-transfer-form').trigger('submit')
  await settle()
}

function button(wrapper: Awaited<ReturnType<typeof mountWorkflow>>, label: string) {
  const match = wrapper.findAll('button').find((candidate) => candidate.text() === label)
  expect(match, `${label} button was not rendered`).toBeDefined()
  return match!
}

function eligiblePreview() {
  return {
    eligible: true as const,
    previewId,
    character,
    destinationMain,
    sourceCharacterCount: 2,
    expiresAt: '2026-09-11T12:05:00.000Z',
  }
}

function pendingApproval(reason: string) {
  return {
    approvalId,
    character,
    destinationMain,
    sourceCharacterCount: 2,
    reason,
    status: 'pending' as const,
    createdAt: '2026-09-11T12:00:00.000Z',
    expiresAt,
    consumedAt: null,
    revokedAt: null,
    revocationReason: null,
  }
}

function response(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

async function settle() {
  await flushPromises()
  await nextTick()
}
