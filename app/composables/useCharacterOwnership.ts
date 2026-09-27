import { useQueryCache } from '@pinia/colada'
import { computed, toValue, type MaybeRefOrGetter } from 'vue'
import {
  readQueryCharacterOwnership,
  readQueryCharacterPendingVerification,
} from '../query-persistence/runtime'

export function useCharacterOwnership(
  characterId: MaybeRefOrGetter<number | undefined>,
  characters: MaybeRefOrGetter<readonly { readonly characterId: number }[]>,
) {
  const admissionOwnership = readQueryCharacterOwnership(useQueryCache(), characterId)
  const pendingVerification = readQueryCharacterPendingVerification(useQueryCache(), characterId)
  return computed(
    () =>
      !pendingVerification.value &&
      (admissionOwnership.value ||
        toValue(characters).some((character) => character.characterId === toValue(characterId))),
  )
}
