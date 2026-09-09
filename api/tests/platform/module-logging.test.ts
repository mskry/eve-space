import { describe, expect, test, vi } from 'vitest'
import { createPlatformModuleLogger } from '../../src/platform/module-logging.js'

describe('platform module logging', () => {
  test('binds module identity and emits bounded structured fields', () => {
    const sink = { info: vi.fn(), warn: vi.fn(), error: vi.fn() }
    const logger = createPlatformModuleLogger('organization-activity', sink)

    logger.info('activity.loaded', {
      moduleId: 'impersonated',
      characterId: 9001,
      stale: false,
    })

    expect(sink.info).toHaveBeenCalledWith('Platform module event', {
      characterId: 9001,
      stale: false,
      moduleId: 'organization-activity',
      event: 'activity.loaded',
    })
  })

  test('drops secret-bearing fields and refuses unstructured values', () => {
    const sink = { info: vi.fn(), warn: vi.fn(), error: vi.fn() }
    const logger = createPlatformModuleLogger('organization-activity', sink)

    logger.warn('activity.authorization-required', {
      accessToken: 'not-for-logs',
      detail: 'Bearer private-value',
      requiredScope: 'esi-example.read.v1',
    })
    expect(sink.warn).toHaveBeenCalledWith('Platform module event', {
      requiredScope: 'esi-example.read.v1',
      moduleId: 'organization-activity',
      event: 'activity.authorization-required',
    })
    expect(JSON.stringify(sink.warn.mock.calls)).not.toContain('private-value')
    expect(() =>
      logger.error('activity.failed', { failure: new Error('private-host') } as never),
    ).toThrow('primitive values')
    expect(JSON.stringify(sink.error.mock.calls)).not.toContain('private-host')
  })

  test('rejects unstable event and module identities', () => {
    expect(() => createPlatformModuleLogger('core')).toThrow('installed module identity')
    const logger = createPlatformModuleLogger('organization-activity', {
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    })
    expect(() => logger.info('Loaded activity')).toThrow('stable identifier')
  })
})
