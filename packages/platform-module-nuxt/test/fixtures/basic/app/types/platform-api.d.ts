import type { Hono } from 'hono'
// oxlint-disable-next-line import/no-unassigned-import -- Required for fixture host augmentation.
import '../../../../../src/runtime/platform-api.js'

type FixtureAppType = Hono<
  {},
  {
    '/api/alpha/:characterId': {
      $get: {
        input: { param: { characterId: string } }
        output: { characterId: number; name: string }
        outputFormat: 'json'
        status: 200
      }
    }
  },
  '/'
>

declare module '../../../../../src/runtime/platform-api.js' {
  interface PlatformApiHost {
    readonly app: FixtureAppType
  }
}
