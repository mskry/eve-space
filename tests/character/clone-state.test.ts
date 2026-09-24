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
    authorizationTitle: 'Clone authorization required',
    errorTitle: 'Clone data unavailable',
    loadingMessage: 'Loading clone data...',
    resourceCode: 'CLONES',
  }

  it('maps loading, authorization, error, and ready states', () => {
    expect(toCloneEsiResourceState(cloneResourceState({ status: 'loading' }), copy)).toStrictEqual({
      message: 'Loading clone data...',
      status: 'loading',
      title: '',
    })
    expect(
      toCloneEsiResourceState(
        cloneResourceState({
          authorizeUrl: '/reauthorize',
          message: 'Authorize clone access.',
          status: 'authorization',
        }),
        copy,
      ),
    ).toStrictEqual({
      action: { href: '/reauthorize', label: 'AUTHORIZE THIS CHARACTER' },
      code: 'ESI 403 / CLONES',
      message: 'Authorize clone access.',
      status: 'authorization-required',
      title: 'Clone authorization required',
    })
    expect(
      toCloneEsiResourceState(
        cloneResourceState({ authorizeUrl: '', status: 'authorization' }),
        copy,
      ),
    ).toMatchObject({ action: null, status: 'authorization-required' })
    expect(
      toCloneEsiResourceState(
        cloneResourceState({ message: 'Clone lookup failed.', status: 'error' }),
        copy,
      ),
    ).toStrictEqual({
      code: 'ERR / CLONES',
      message: 'Clone lookup failed.',
      retryLabel: 'RETRY UPLINK',
      status: 'error',
      title: 'Clone data unavailable',
    })
    expect(toCloneEsiResourceState(cloneResourceState(), copy)).toStrictEqual({ status: 'ready' })
  })
})

function cloneResourceState(overrides: Partial<CloneResourceState> = {}): CloneResourceState {
  return {
    authorizeUrl: '',
    message: '',
    status: 'ready',
    ...overrides,
  }
}
