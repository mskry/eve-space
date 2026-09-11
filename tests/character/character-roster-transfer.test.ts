import { describe, expect, it } from 'vitest'
import { readWorkspaceFile } from '../support/read-workspace-file'

describe('character roster transfer feedback', () => {
  const roster = readWorkspaceFile('app/pages/characters/index.vue')

  it.each([
    ['approval-required', 'deployment-administrator approval'],
    ['approval-unusable', 'can no longer be used'],
    ['main-character', 'choose another main character'],
    ['authority-evidence', 'Remove active organization authority'],
    ['corporation-source', 'Replace or revoke the active corporation data source'],
  ])('provides actionable %s feedback without account details', (status, guidance) => {
    expect(roster).toContain(`attachStatus.value === '${status}'`)
    expect(roster).toContain(guidance)
  })

  it('treats the retired conflict result as a generic retry', () => {
    const conflictFeedback = roster.slice(
      roster.indexOf("attachStatus.value === 'conflict'"),
      roster.indexOf("attachStatus.value === 'cancelled'"),
    )

    expect(conflictFeedback).toContain('Start a new character authorization and try again.')
    expect(conflictFeedback).not.toContain('another EVE Space account')
  })

  it('refreshes destination session and roster state independently after success', () => {
    expect(roster).toContain("callbackStatus === 'success'")
    expect(roster).toContain('Promise.allSettled([initializeAuth(true), refetchCharacterRoster()])')
    expect(roster).toContain(":role=\"attachFeedbackIsError ? 'alert' : 'status'\"")
  })
})
