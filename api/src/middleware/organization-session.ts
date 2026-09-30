import { createMiddleware } from 'hono/factory'
import type { OrganizationSessionContext } from '../organization/access-policy.js'
import { loadOrganizationSessionContext } from '../organization/session-context.js'
import type { SessionEnv } from './auth-session.js'

export type OrganizationSessionEnv = {
  Variables: SessionEnv['Variables'] & {
    organization: OrganizationSessionContext | null
  }
}

export const loadOrganizationSession = createMiddleware<OrganizationSessionEnv>(
  async (context, next) => {
    const session = context.var.session
    context.set(
      'organization',
      session ? await loadOrganizationSessionContext(session.userId) : null,
    )
    await next()
  },
)
