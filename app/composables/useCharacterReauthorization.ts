import { inject, provide, watch, type ComputedRef, type InjectionKey } from 'vue'

export type ReauthorizeStatus = '' | 'cancelled' | 'error' | 'success'

interface CharacterReauthorizationCycle {
  begin: (status: ReauthorizeStatus) => void
  consume: (status: unknown) => boolean
  finish: () => void
}

const characterReauthorizationKey: InjectionKey<Pick<CharacterReauthorizationCycle, 'consume'>> =
  Symbol('character-reauthorization')

export function createCharacterReauthorizationCycle(): CharacterReauthorizationCycle {
  let activeStatus: ReauthorizeStatus = ''
  let consumed = false

  return {
    begin(status) {
      activeStatus = status
      consumed = false
    },
    consume(status) {
      if (status !== 'success' || status !== activeStatus || consumed) return false
      consumed = true
      return true
    },
    finish() {
      activeStatus = ''
      consumed = false
    },
  }
}

export function provideCharacterReauthorization() {
  const cycle = createCharacterReauthorizationCycle()
  provide(characterReauthorizationKey, cycle)
  return cycle
}

export function useCharacterReauthorization(
  characterId: ComputedRef<number | undefined>,
  onSuccess: () => void,
) {
  const route = useRoute()
  const cycle = inject(characterReauthorizationKey)

  if (!cycle) throw new Error('Character reauthorization requires the character record shell')

  watch(
    [characterId, () => route.query.reauthorize],
    ([id, status]) => {
      if (id !== undefined && cycle.consume(status)) onSuccess()
    },
    { flush: 'post', immediate: true },
  )
}
