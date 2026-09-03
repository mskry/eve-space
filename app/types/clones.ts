type CloneResourceStatus = 'ready' | 'loading' | 'authorization' | 'error'

export interface CloneResourceState {
  status: CloneResourceStatus
  message: string
  authorizeUrl: string
}
