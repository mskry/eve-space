import { Hono } from 'hono'
import { privateNoStore } from '../http/private-response.js'
import { loadSession, requireSession } from '../middleware/auth-session.js'
import {
  loadOrganizationSession,
  type OrganizationSessionEnv,
} from '../middleware/organization-session.js'
import { organizationGovernanceRoutes } from './routes-governance.js'
import { organizationManagementRoutes } from './routes-management.js'
import { organizationMemberRoutes } from './routes-member.js'
import { organizationReviewRoutes } from './routes-review.js'
import { organizationRuleRoutes } from './routes-rules.js'

export const organizationRoutes = new Hono<OrganizationSessionEnv>()
  .use('*', privateNoStore, loadSession, requireSession, loadOrganizationSession)
  .route('/', organizationMemberRoutes)
  .route('/', organizationGovernanceRoutes)
  .route('/', organizationReviewRoutes)
  .route('/', organizationManagementRoutes)
  .route('/', organizationRuleRoutes)
