import type { CloneResourceState } from '../types/clones'
import type { EsiResourceState } from '../types/esi-resource'

interface CloneResourceStateCopy {
  resourceCode: string
  loadingMessage: string
  authorizationTitle: string
  errorTitle: string
}

export function toCloneEsiResourceState(
  state: CloneResourceState,
  copy: CloneResourceStateCopy,
): EsiResourceState {
  if (state.status === 'loading') {
    return { message: copy.loadingMessage, status: 'loading', title: '' }
  }
  if (state.status === 'authorization') {
    return {
      action: state.authorizeUrl
        ? { href: state.authorizeUrl, label: 'AUTHORIZE THIS CHARACTER' }
        : null,
      code: `ESI 403 / ${copy.resourceCode}`,
      message: state.message,
      status: 'authorization-required',
      title: copy.authorizationTitle,
    }
  }
  if (state.status === 'error') {
    return {
      code: `ERR / ${copy.resourceCode}`,
      message: state.message,
      retryLabel: 'RETRY UPLINK',
      status: 'error',
      title: copy.errorTitle,
    }
  }
  return { status: 'ready' }
}
