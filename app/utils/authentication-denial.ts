import { ApiQueryError } from './query-error'

export function isAuthenticationDenial(error: unknown) {
  return error instanceof ApiQueryError && (error.status === 401 || error.code === 'AUTH_REQUIRED')
}
