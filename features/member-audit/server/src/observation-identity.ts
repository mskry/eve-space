export function createObservationId(
  resourceId: string,
  subjectLifecycleId: string,
  validatedAt: string,
) {
  const source = `${resourceId}:${subjectLifecycleId}:${validatedAt}`
  const hex = [0, 1, 2, 3]
    .map((salt) => hashObservationIdentity(source, salt).toString(16).padStart(8, '0'))
    .join('')
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-8${hex.slice(17, 20)}-${hex.slice(20)}`
}

function hashObservationIdentity(value: string, salt: number) {
  let hash = (2_166_136_261 + salt * 16_777_619) >>> 0
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.codePointAt(index)!
    hash = Math.imul(hash, 16_777_619) >>> 0
  }
  return hash
}
