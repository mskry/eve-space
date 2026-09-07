import type { PlatformModuleErrorBody } from '@eve-space/platform-module-contract'
import { HTTPException } from 'hono/http-exception'

export const platformModuleErrorStatuses = [400, 403, 404, 409, 422, 429, 502, 503] as const
export type PlatformModuleErrorStatus = (typeof platformModuleErrorStatuses)[number]

const errorCodePattern = /^[A-Z][A-Z0-9_]*$/

export class PlatformModuleHttpError extends HTTPException {
  readonly body: PlatformModuleErrorBody

  constructor(status: PlatformModuleErrorStatus, body: PlatformModuleErrorBody) {
    assertPlatformModuleErrorBody(body)
    super(status, { message: body.message })
    this.name = 'PlatformModuleHttpError'
    this.body = Object.freeze({ code: body.code, message: body.message })
  }
}

export function platformModuleError(
  status: PlatformModuleErrorStatus,
  body: PlatformModuleErrorBody,
) {
  return new PlatformModuleHttpError(status, body)
}

function assertPlatformModuleErrorBody(body: PlatformModuleErrorBody) {
  if (!errorCodePattern.test(body.code) || body.code.length > 100)
    throw new TypeError('Platform module error code must use bounded uppercase snake case')
  if (body.message.trim().length === 0 || body.message.length > 500)
    throw new TypeError('Platform module error message must be between 1 and 500 characters')
}
