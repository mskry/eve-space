export const purgeInBatches = async <Input extends { readonly limit: number }>(
  input: Omit<Input, 'limit'>,
  invoke: (request: Input) => Promise<{ readonly remaining: boolean }>,
  signal?: AbortSignal,
) => {
  let remaining = true
  while (remaining) {
    signal?.throwIfAborted()
    // oxlint-disable-next-line no-await-in-loop -- SAFETY: The bounded limit is supplied here; the next batch depends on this result.
    const result = await invoke({ ...input, limit: 1000 } as Input)
    remaining = result.remaining
  }
}
