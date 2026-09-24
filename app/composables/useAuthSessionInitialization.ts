import { useQueryCache } from '@pinia/colada'
import type { ApiClient } from '../utils/api-client'
import { isAuthenticationDenial } from '../utils/authentication-denial'
import {
  authSessionQuery,
  loadAuthBootstrap,
  loadCacheAdmission,
  type AuthSession,
} from '../queries/auth'
import { useAuthVerification } from './useAuthVerification'

export function useAuthSessionInitialization(apiClient: ApiClient) {
  const queryCache = useQueryCache()
  const authVerification = useAuthVerification()
  const options = {
    ...authSessionQuery(apiClient),
    query: async (context: Parameters<ReturnType<typeof authSessionQuery>['query']>[0]) => {
      const verificationGeneration = authVerification.beginVerification()
      const settleCancellation = () => {
        queueMicrotask(() => {
          authVerification.markUnavailable(queryCache, verificationGeneration, {
            retainPrivateData: true,
          })
        })
      }
      context.signal.addEventListener('abort', settleCancellation, { once: true })
      try {
        const { session, admission } = await loadAuthBootstrap(apiClient, context.signal)
        const accepted = await authVerification.markVerified(
          queryCache,
          verificationGeneration,
          session,
          (signal) => loadCacheAdmission(apiClient, signal),
          context.signal,
          admission,
        )
        if (!accepted) {
          if (context.entry.pending?.abortController.signal === context.signal) {
            queryCache.cancel(context.entry, new Error('Session verification superseded.'))
          }
        }
        return session
      } catch (error) {
        if (!context.signal.aborted) {
          authVerification.markUnavailable(queryCache, verificationGeneration, {
            retainPrivateData: !isAuthenticationDenial(error),
          })
        }
        throw error
      } finally {
        context.signal.removeEventListener('abort', settleCancellation)
      }
    },
  }

  async function initialize(force = false): Promise<AuthSession | undefined> {
    if (import.meta.server) {
      return
    }
    const entry = queryCache.ensure(options)
    const requiresVerification =
      authVerification.state.value.status === 'idle' ||
      authVerification.state.value.status === 'unavailable'
    try {
      if (entry.pending) {
        await entry.pending.refreshCall
      } else if (force || requiresVerification) {
        await queryCache.fetch(entry)
      } else {
        await queryCache.refresh(entry)
      }
    } catch {
      return
    }
    if (authVerification.state.value.status !== 'verified' || entry.pending) {
      return
    }
    return queryCache.getQueryData<AuthSession>(options.key)
  }

  return { initialize, options, verification: authVerification }
}
