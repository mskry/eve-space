export const platformQueryAdmissionScopes = [
  {
    moduleId: 'alpha',
    routeId: 'alpha-summary',
    admissionScope: 'organization:v1:alpha:member:alpha.view',
    authorization: 'authenticated-session',
    audience: 'member',
    requiredPermission: 'alpha.view',
  },
  {
    moduleId: 'alpha',
    routeId: 'alpha-record',
    admissionScope: 'organization:v1:alpha:member:alpha.view',
    authorization: 'owned-character',
    audience: 'member',
    requiredPermission: 'alpha.view',
  },
  {
    moduleId: 'mail',
    routeId: 'mail-route',
    admissionScope: 'organization:v1:mail:member:mail.view',
    authorization: 'owned-character',
    audience: 'member',
    requiredPermission: 'mail.view',
  },
  {
    moduleId: 'mail',
    routeId: 'mail-summary',
    admissionScope: 'organization:v1:mail:member:mail.view',
    authorization: 'authenticated-session',
    audience: 'member',
    requiredPermission: 'mail.view',
  },
] as const
