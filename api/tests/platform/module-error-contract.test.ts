import type { PlatformModuleErrorBody } from '@eve-space/platform-module-contract'
import { hc, type InferResponseType } from 'hono/client'
import { describe, expectTypeOf, test } from 'vitest'
import type { AppType } from '../../src/index.js'

const client = hc<AppType>('http://localhost:8788')

type GlobalError<Status extends 400 | 403 | 404 | 409 | 422 | 429 | 502 | 503> = InferResponseType<
  typeof client.health.$get,
  Status
>

describe('mounted platform module error contract', () => {
  test('includes coded module errors for every supported status', () => {
    expectTypeOf<PlatformModuleErrorBody>().toMatchTypeOf<GlobalError<400>>()
    expectTypeOf<PlatformModuleErrorBody>().toMatchTypeOf<GlobalError<403>>()
    expectTypeOf<PlatformModuleErrorBody>().toMatchTypeOf<GlobalError<404>>()
    expectTypeOf<PlatformModuleErrorBody>().toMatchTypeOf<GlobalError<409>>()
    expectTypeOf<PlatformModuleErrorBody>().toMatchTypeOf<GlobalError<422>>()
    expectTypeOf<PlatformModuleErrorBody>().toMatchTypeOf<GlobalError<429>>()
    expectTypeOf<PlatformModuleErrorBody>().toMatchTypeOf<GlobalError<502>>()
    expectTypeOf<PlatformModuleErrorBody>().toMatchTypeOf<GlobalError<503>>()
  })

  test('retains message-only global errors alongside module errors', () => {
    expectTypeOf<{ message: string }>().toMatchTypeOf<GlobalError<400>>()
    expectTypeOf<Extract<GlobalError<409>, { code: string }>['code']>().toEqualTypeOf<string>()
  })
})
