export interface PlatformResourceAction {
  readonly href: string
  readonly label: string
}

interface PlatformResourceStateBase {
  readonly code?: string
  readonly message?: string | null
  readonly retryAt?: string | null
  readonly title: string
}

export type PlatformResourceState =
  | { readonly status: 'ready' }
  | (PlatformResourceStateBase & { readonly status: 'loading' })
  | (PlatformResourceStateBase & {
      readonly status: 'authorization-required'
      readonly action?: PlatformResourceAction | null
      readonly retryLabel?: string
    })
  | (PlatformResourceStateBase & {
      readonly status: 'error'
      readonly retryLabel?: string
      readonly tone?: 'default' | 'error'
    })
  | (PlatformResourceStateBase & {
      readonly status: 'unavailable'
      readonly retryLabel?: string
      readonly tone?: 'default' | 'error'
    })
  | (PlatformResourceStateBase & {
      readonly status: 'stale'
      readonly retryLabel?: string
    })
