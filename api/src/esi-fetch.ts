import { env } from './env.js'

export const esiFetch: typeof globalThis.fetch = (input, init) => {
  const headers = new Headers(init?.headers)
  headers.set('User-Agent', env.ESI_USER_AGENT)
  return globalThis.fetch(input, { ...init, headers })
}
