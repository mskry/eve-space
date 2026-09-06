interface EsiAuthorizationAction {
  href: string
  label: string
}

interface EsiResourceStateBase {
  code?: string
  message?: string | null
  retryAt?: string | null
  title: string
}

export type EsiResourceState =
  | { status: 'ready' }
  | (EsiResourceStateBase & { status: 'loading' })
  | (EsiResourceStateBase & {
      status: 'authorization-required'
      action?: EsiAuthorizationAction | null
      retryLabel?: string
    })
  | (EsiResourceStateBase & {
      status: 'error'
      retryLabel?: string
      tone?: 'default' | 'error'
    })
