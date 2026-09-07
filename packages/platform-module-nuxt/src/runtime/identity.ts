import { inject, provide, type ComputedRef, type InjectionKey } from 'vue'

const identityKey: InjectionKey<() => PlatformIdentity> = Symbol('platform-identity')

export interface PlatformIdentity {
  readonly authenticated: ComputedRef<boolean>
  readonly organizationAuthorized: ComputedRef<boolean>
  readonly organizationVersion: ComputedRef<number>
  readonly characters: ComputedRef<
    readonly {
      readonly characterId: number
      readonly name: string
      readonly corporationId: number
    }[]
  >
}

export function providePlatformIdentity(factory: () => PlatformIdentity) {
  provide(identityKey, factory)
}

export function usePlatformIdentity() {
  const factory = inject(identityKey)
  if (!factory) throw new Error('Platform identity has not been provided by the host')
  return factory()
}
