const hasStatus = (error: unknown): error is { status: unknown } =>
  typeof error === 'object' && error !== null && 'status' in error

export const errorStatus = (error: unknown): number | undefined =>
  hasStatus(error) ? Number(error.status) : undefined
