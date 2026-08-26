export const routeNotFoundBody = { message: 'Route not found' } as const
export const authRequiredBody = {
  code: 'AUTH_REQUIRED',
  message: 'Log in with EVE Online first.',
} as const
