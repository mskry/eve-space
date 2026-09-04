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
    return { status: 'loading', title: '', message: copy.loadingMessage }
  }
  if (state.status === 'authorization') {
    return {
      status: 'authorization-required',
      code: `ESI 403 / ${copy.resourceCode}`,
      title: copy.authorizationTitle,
      message: state.message,
      action: state.authorizeUrl
        ? { href: state.authorizeUrl, label: 'AUTHORIZE THIS CHARACTER' }
        : null,
    }
  }
  if (state.status === 'error') {
    return {
      status: 'error',
      code: `ERR / ${copy.resourceCode}`,
      title: copy.errorTitle,
      message: state.message,
      retryLabel: 'RETRY UPLINK',
    }
  }
  return { status: 'ready' }
}
