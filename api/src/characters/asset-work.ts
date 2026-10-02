import type { ReadAdmissionWork } from '../auth/read-work.js'

export interface CharacterAssetWindowWork extends ReadAdmissionWork {
  readonly signal: AbortSignal
}

export const immediateAssetWork = (
  signal: AbortSignal = new AbortController().signal,
): CharacterAssetWindowWork => ({
  signal,
  run: async (read) => {
    signal.throwIfAborted()
    const result = await read()
    signal.throwIfAborted()
    return result
  },
})
