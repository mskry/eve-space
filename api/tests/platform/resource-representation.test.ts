import { describe, expect, test } from 'vitest'
import { normalizePositiveSafeIntegerIds } from '../../src/platform/resource-id-list.js'
import {
  findInstalledResource,
  installedResourceIdentityKey,
} from '../../src/platform/resource-identity.js'
import { toPlatformResourceSubject } from '../../src/platform/resource-subject.js'

describe('platform resource representation', () => {
  test('normalizes positive safe integer ID collections', () => {
    expect(normalizePositiveSafeIntegerIds([3, '2', 3, 1], 'Resource')).toEqual([1, 2, 3])
    expect(() => normalizePositiveSafeIntegerIds([0], 'Resource')).toThrow(
      'Resource contains an invalid ID',
    )
  })

  test('uses one installed-resource identity for lookup and grouping', () => {
    const resource = {
      moduleId: 'member-audit',
      resourceId: 'trained-skills',
      subjectKind: 'character',
    }

    expect(installedResourceIdentityKey(resource)).toBe(
      installedResourceIdentityKey({ ...resource }),
    )
    expect(findInstalledResource(resource, [resource as never])).toBe(resource)
    expect(
      findInstalledResource({ ...resource, subjectKind: 'corporation' }, [resource as never]),
    ).toBeUndefined()
  })

  test('converts valid lifecycle identities to typed subjects', () => {
    expect(
      toPlatformResourceSubject({
        subjectKind: 'character',
        subjectId: '1404328063',
        subjectLifecycleId: '35acd527-9539-44ad-aacf-9f8e45232267',
      }),
    ).toEqual({
      kind: 'character',
      characterId: 1_404_328_063,
      lifecycleId: '35acd527-9539-44ad-aacf-9f8e45232267',
    })
    expect(
      toPlatformResourceSubject({
        subjectKind: 'alliance',
        subjectId: 'invalid',
        subjectLifecycleId: '35acd527-9539-44ad-aacf-9f8e45232267',
      }),
    ).toBeNull()
  })
})
