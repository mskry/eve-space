import { createMiddleware } from 'hono/factory'

export const privateNoStore = createMiddleware(async (context, next) => {
  setPrivateHeaders(context)
  await next()
})

export function setPrivateHeaders(context: {
  header: (name: string, value: string, options?: never) => void
}) {
  context.header('Cache-Control', 'private, no-store')
  context.header('Vary', 'Cookie')
}
