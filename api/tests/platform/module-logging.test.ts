import { describe, expect, test, vi } from 'vitest'
import { apiLogger } from '../../src/logging.js'
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

  test('routes the default sink through bounded runtime diagnostics', () => {
    const info = vi.spyOn(console, 'info').mockImplementation(() => undefined)
    apiLogger.enableLogging()
    try {
      createPlatformModuleLogger('organization-activity').info('activity.loaded', {
        characterId: 9001,
        detail: 'Bearer private-value',
      })

      const serialized = String(info.mock.calls[0]?.[0])
      expect(JSON.parse(serialized)).toEqual(
        expect.objectContaining({
          correlationId: expect.stringMatching(/^[0-9a-f-]{36}$/),
          event: 'platform.module.info',
          moduleEvent: 'activity.loaded',
          moduleId: 'organization-activity',
        }),
      )
      expect(serialized).not.toContain('characterId')
      expect(serialized).not.toContain('private-value')
    } finally {
      apiLogger.disableLogging()
      info.mockRestore()
    }
  })
})
