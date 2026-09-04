import { describe, expect, it } from 'vitest'
import type { CloneResourceState } from '../../app/types/clones'
import { toCloneEsiResourceState } from '../../app/utils/clone-resource-state'
import { inferCloneState } from '../../app/utils/clone-state'

describe('clone state inference', () => {
  it('infers alpha when a trained skill level is inactive', () => {
    expect(
      inferCloneState({
        groups: [{ skills: [{ activeLevel: 4, trainedLevel: 5 }] }],
      }),
    ).toBe('alpha')
  })

  it('does not infer omega from equal active and trained levels', () => {
    expect(
      inferCloneState({
        groups: [{ skills: [{ activeLevel: 5, trainedLevel: 5 }] }],
      }),
    ).toBeUndefined()
  })

  it('returns no status for an empty archive', () => {
    expect(inferCloneState({ groups: [] })).toBeUndefined()
  })
})

describe('clone ESI resource state', () => {
  const copy = {
    resourceCode: 'CLONES',
    loadingMessage: 'Loading clone data...',
    authorizationTitle: 'Clone authorization required',
    errorTitle: 'Clone data unavailable',
  }

  it('maps loading, authorization, error, and ready states', () => {
    expect(toCloneEsiResourceState(cloneResourceState({ status: 'loading' }), copy)).toEqual({
      status: 'loading',
      title: '',
      message: 'Loading clone data...',
    })
    expect(
      toCloneEsiResourceState(
        cloneResourceState({
          status: 'authorization',
          message: 'Authorize clone access.',
          authorizeUrl: '/reauthorize',
        }),
        copy,
      ),
    ).toEqual({
      status: 'authorization-required',
      code: 'ESI 403 / CLONES',
      title: 'Clone authorization required',
      message: 'Authorize clone access.',
      action: { href: '/reauthorize', label: 'AUTHORIZE THIS CHARACTER' },
    })
    expect(
      toCloneEsiResourceState(
        cloneResourceState({ status: 'authorization', authorizeUrl: '' }),
        copy,
      ),
    ).toMatchObject({ status: 'authorization-required', action: null })
    expect(
      toCloneEsiResourceState(
        cloneResourceState({ status: 'error', message: 'Clone lookup failed.' }),
        copy,
      ),
    ).toEqual({
      status: 'error',
      code: 'ERR / CLONES',
      title: 'Clone data unavailable',
      message: 'Clone lookup failed.',
      retryLabel: 'RETRY UPLINK',
    })
    expect(toCloneEsiResourceState(cloneResourceState(), copy)).toEqual({ status: 'ready' })
  })
})

function cloneResourceState(overrides: Partial<CloneResourceState> = {}): CloneResourceState {
  return {
    status: 'ready',
    message: '',
    authorizeUrl: '',
    ...overrides,
  }
}
