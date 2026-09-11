import { describe, expect, it } from 'vitest'
import { readWorkspaceFile } from '../support/read-workspace-file'

describe('destination character transfer page', () => {
  const page = readWorkspaceFile('app/pages/transfer.vue')
  const authSession = readWorkspaceFile('app/composables/useAuthSession.ts')

  it('keeps the fragment route out of the authentication redirect middleware', () => {
    expect(page).toContain("platformAudience: 'public'")
    expect(page).toContain("layout: 'auth'")
  })

  it('reads the approval secret once and removes it from browser history', () => {
    expect(page).toContain('new URLSearchParams(globalThis.location.hash.slice(1))')
    expect(page).toContain("parameters.get('approval')")
    expect(page).toContain("parameters.get('secret')")
    expect(page).toContain('globalThis.history.replaceState(')
    expect(page).toContain('onBeforeUnmount(() => {')
    expect(page).not.toMatch(/use(?:State|Cookie|Storage)\(/)
    expect(page).not.toContain('localStorage')
    expect(page).not.toContain('sessionStorage')
  })

  it('starts transfer SSO only from the authenticated explicit action', () => {
    expect(authSession).toContain('enabled: import.meta.client')
    expect(page).toContain('v-else-if="!authSession.authenticated"')
    expect(page).toContain('@click="transferMutation.mutate()"')
    expect(page).toContain('apiClient.auth.eve.transfer.$post')
    expect(page).not.toContain('onMounted(() => transferMutation')
    expect(page).not.toContain('useFetch')
    expect(page).not.toContain('useAsyncData')
  })

  it('uses generic invalid and wrong-session guidance', () => {
    expect(page).toContain('Ask a deployment administrator for a new transfer link.')
    expect(page).toContain('page cannot identify the intended account.')
    expect(page).toContain(
      'This transfer link cannot be used from this session or is no longer valid.',
    )
    expect(page).toContain('ask a deployment administrator for a replacement link')
    expect(page).not.toContain('v-html')
  })
})
