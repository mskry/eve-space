import { useQueryCache } from '@pinia/colada'
import { computed, toValue, type MaybeRefOrGetter } from 'vue'
import { readQueryCharacterOwnership } from '../query-persistence/runtime'

export function useCharacterOwnership(
  characterId: MaybeRefOrGetter<number | undefined>,
  characters: MaybeRefOrGetter<readonly { readonly characterId: number }[]>,
) {
  const admissionOwnership = readQueryCharacterOwnership(useQueryCache(), characterId)
  return computed(
    () =>
      admissionOwnership.value ||
      toValue(characters).some((character) => character.characterId === toValue(characterId)),
  )
}
