import { z } from 'zod'
import type { ReadAdmissionWork } from '../auth/read-work.js'
import { readRequestSession } from '../middleware/auth-session.js'
import { recordDiagnostic } from '../logging.js'
import { createGraphQLHostAdapter } from './host-adapter.js'
import { applicationGraphQLPolicies, applicationGraphQLSchema } from './schema.js'
import { createGraphQLReadExecution } from './request-execution.js'
import { createCoreCharacterReads } from './core-character-reads.js'

export const graphqlRoutes = createGraphQLHostAdapter(
  applicationGraphQLSchema,
  (_request, { work, cache }, context) => {
    const liveSession = (slot: ReadAdmissionWork = work) =>
      slot.run(() => readRequestSession(context))
    return {
      signal: work.signal,
      characters: createCoreCharacterReads(liveSession, work, work),
      execution: createGraphQLReadExecution({
        signal: work.signal,
        liveSession,
        cache,
        cachePolicy: cache,
        state: work,
      }),
    }
  },
  applicationGraphQLPolicies,
  (context) => {
    const requestId = z.uuid().safeParse(context.get('logger')?.getContext().requestId)
    recordDiagnostic('api.request.failed', {
      context: { method: context.req.method, path: '/api/graphql' },
      correlationId: requestId.success ? requestId.data : undefined,
    })
  },
)
