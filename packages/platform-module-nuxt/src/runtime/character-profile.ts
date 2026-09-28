import type { PublicCharacterProfileResult } from '@eve-space/core-data-contract'
import { inject, provide, type Component, type InjectionKey } from 'vue'

export interface PlatformCharacterProfileProps {
  readonly profile: PublicCharacterProfileResult | null
  readonly state: 'loading' | 'ready' | 'unavailable'
}

export type PlatformCharacterProfileComponent = Component<PlatformCharacterProfileProps>

const characterProfileKey: InjectionKey<PlatformCharacterProfileComponent> = Symbol(
  'platform-character-profile',
)

export const providePlatformCharacterProfile = (presenter: PlatformCharacterProfileComponent) => {
  provide(characterProfileKey, presenter)
}

export const usePlatformCharacterProfile = () => {
  const presenter = inject(characterProfileKey)
  if (!presenter) throw new Error('Platform character profile presenter is unavailable')
  return presenter
}
