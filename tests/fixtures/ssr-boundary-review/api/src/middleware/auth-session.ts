import type { MiddlewareHandler } from 'hono'

export const loadSession: MiddlewareHandler = async (_context, next) => next()

export const requireSession: MiddlewareHandler = async (_context, next) => next()
