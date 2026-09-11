import { createMiddleware } from 'hono/factory'
import { env } from '../env.js'

export const requireTrustedMutationOrigin = createMiddleware(async (context, next) => {
  if (context.req.method === 'GET' || context.req.method === 'HEAD') return next()
  if (context.req.header('Origin') !== env.WEB_ORIGIN) {
    return context.json({ code: 'INVALID_ORIGIN', message: 'Request origin is not allowed.' }, 403)
  }
  return next()
})
