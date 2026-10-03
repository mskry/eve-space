import { z } from 'zod'
import type { PlatformInventoryRead } from '@eve-space/platform-module-contract/inventory'
import { inventoryFingerprint } from '../inventory-policy.js'

const cursorSchema = z.strictObject({
  version: z.literal(1),
  authority: z.string().regex(/^[a-f\d]{64}$/),
  query: z.string().regex(/^[a-f\d]{64}$/),
  view: z.string().regex(/^[a-f\d]{64}$/),
  position: z.string().min(1).max(256),
  provider: z.string().max(2048).nullable(),
})
const groupPosition = z.tuple([
  z.int().positive(),
  z.enum(['none', 'original', 'copy']),
  z.string().min(1).max(100),
])
const readSchema = z.discriminatedUnion('kind', [
  z.strictObject({
    kind: z.literal('groups'),
    first: z.number().int().min(1).max(100),
    after: z.string().min(1).max(4096).optional(),
    filters: z
      .strictObject({
        typeId: z.int().positive().optional(),
        groupId: z.int().positive().optional(),
        categoryId: z.int().positive().optional(),
        locationKey: z.string().min(1).max(100).optional(),
      })
      .optional(),
  }),
  z.strictObject({
    kind: z.literal('holders'),
    first: z.number().int().min(1).max(100),
    after: z.string().min(1).max(4096).optional(),
    groupKey: z.string().max(256),
  }),
  z.strictObject({
    kind: z.literal('coverage'),
    first: z.number().int().min(1).max(100),
    after: z.string().min(1).max(4096).optional(),
  }),
])

export type InventoryCursor = z.infer<typeof cursorSchema>

export class InventoryRestartError extends Error {
  readonly code = 'INVENTORY_RESTART_REQUIRED'
  constructor() {
    super('Inventory changed. Restart pagination.')
  }
}

export const normalizeInventoryRead = (read: PlatformInventoryRead): PlatformInventoryRead => {
  try {
    const value = readSchema.parse(read)
    if (value.kind === 'holders') groupPosition.parse(JSON.parse(value.groupKey))
    return value
  } catch {
    throw Object.assign(new Error('Invalid inventory read.'), { code: 'BAD_USER_INPUT' })
  }
}

const assertCursorPosition = (
  read: PlatformInventoryRead,
  cursor: InventoryCursor,
  scope: 'personal' | 'corporation',
) => {
  if (scope === 'corporation' && read.kind !== 'coverage') {
    if (cursor.position !== 'provider' || !cursor.provider) throw new InventoryRestartError()
    return
  }
  if (scope === 'personal' && cursor.provider !== null) throw new InventoryRestartError()
  if (read.kind === 'groups') {
    groupPosition.parse(JSON.parse(cursor.position))
    return
  }
  if (!/^[1-9]\d{0,15}$/.test(cursor.position) || !Number.isSafeInteger(Number(cursor.position)))
    throw new InventoryRestartError()
}

const inventoryQueryFingerprint = (read: PlatformInventoryRead) =>
  inventoryFingerprint({
    kind: read.kind,
    filters: read.kind === 'groups' ? (read.filters ?? {}) : {},
    groupKey: read.kind === 'holders' ? read.groupKey : null,
  })

export const decodeInventoryCursor = (
  read: PlatformInventoryRead,
  authority: string,
  scope: 'personal' | 'corporation',
): InventoryCursor | null => {
  if (!read.after) return null
  try {
    if (read.after.length > 4096) throw new InventoryRestartError()
    const bytes = Buffer.from(read.after, 'base64url')
    if (bytes.toString('base64url') !== read.after) throw new InventoryRestartError()
    const value = cursorSchema.parse(JSON.parse(bytes.toString('utf8')))
    if (value.authority !== authority || value.query !== inventoryQueryFingerprint(read))
      throw new InventoryRestartError()
    assertCursorPosition(read, value, scope)
    return value
  } catch {
    throw new InventoryRestartError()
  }
}

export const encodeInventoryCursor = (
  read: PlatformInventoryRead,
  authority: string,
  view: string,
  position: string | undefined,
  provider: string | null = null,
): string | null =>
  position === undefined
    ? null
    : Buffer.from(
        JSON.stringify(
          cursorSchema.parse({
            version: 1,
            authority,
            query: inventoryQueryFingerprint(read),
            view,
            position,
            provider,
          }),
        ),
      ).toString('base64url')

export const assertInventoryCursorView = (cursor: InventoryCursor | null, view: string) => {
  if (cursor && cursor.view !== view) throw new InventoryRestartError()
}
