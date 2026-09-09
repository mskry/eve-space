export type AdminOrganizationType = 'corporation' | 'alliance'

export interface AdminLoginPayload {
  email: string
  password: string
}

export interface AdminSetupPayload {
  email: string
  organizationId: string
  organizationType: AdminOrganizationType
  password: string
  setupSecret: string
}
