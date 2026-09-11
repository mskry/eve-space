import { describe, expect, it } from 'vitest'
import { readWorkspaceFile } from '../support/read-workspace-file'

describe('administrator character transfer workflow', () => {
  const component = readWorkspaceFile('app/components/admin/CharacterTransferApprovals.vue')
  const page = readWorkspaceFile('app/pages/admin/index.vue')

  it('keeps the workflow behind the client-gated administrator session', () => {
    expect(page).toContain('enabled: import.meta.client')
    expect(page).toContain('<template v-else>')
    expect(page).toContain('<AdminCharacterTransferApprovals />')
  })

  it('requires exact character locators and a bounded reason before preview', () => {
    expect(component).toContain(
      'destinationMainCharacterId: Number(destinationMainCharacterId.value)',
    )
    expect(component).toContain('reason: reason.value')
    expect(component).toContain('maxlength="1000"')
    expect(component).toContain('@submit.prevent="previewMutation.mutate()"')
  })

  it('offers approval and one-time link copy only after an eligible preview', () => {
    expect(component).toContain('<template v-if="transferPreview.eligible">')
    expect(component).toContain('@click="approvalMutation.mutate()"')
    expect(component).toContain('navigator.clipboard.writeText(transferLink.value)')
    expect(component).toContain(':value="transferLink" readonly')
  })

  it('renders actionable blocker guidance as text', () => {
    for (const blocker of [
      'main-character',
      'authority-evidence',
      'corporation-source',
      'destination-main',
      'same-account',
    ]) {
      expect(component).toContain(`blocker === '${blocker}'`)
    }
    expect(component).not.toContain('v-html')
  })

  it('supports status inspection and pending approval revocation', () => {
    expect(component).toContain('@submit.prevent="inspectionMutation.mutate()"')
    expect(component).toContain('v-if="approval.status === \'pending\'"')
    expect(component).toContain('@submit.prevent="revocationMutation.mutate()"')
    expect(component).toContain('aria-label="Approval history"')
  })
})
