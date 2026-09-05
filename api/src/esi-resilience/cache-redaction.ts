export function assertCacheValueSafe(value: unknown): void {
  if (typeof value !== 'object' || value === null) return
  for (const [key, nested] of Object.entries(value)) {
    if (/token|bearer|credential|secret|session/i.test(key)) throw new Error('Unsafe cache value')
    assertCacheValueSafe(nested)
  }
}
