// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import { defineComponent, h, ref } from 'vue'
import {
  providePlatformConfirmDialog,
  usePlatformConfirmDialog,
} from '../src/runtime/confirm-dialog.js'

const wrappers: ReturnType<typeof mount>[] = []
afterEach(() => wrappers.splice(0).forEach((wrapper) => wrapper.unmount()))

describe('confirmation dialog lifecycle', () => {
  it('requires a provider', () => {
    const app = defineComponent({
      setup() {
        usePlatformConfirmDialog()
        return () => null
      },
    })
    expect(() => mount(app)).toThrow('must be used under a platform dialog provider')
  })
  it('resolves reactive labels and resets state when closed', () => {
    const { dialog, consumer } = setupDialog()
    expect(dialog.title.value).toBe('Confirm action')
    expect(dialog.cancelLabel.value).toBe('Cancel')
    expect(dialog.confirmLabel.value).toBe('Confirm')
    expect(dialog.pendingLabel.value).toBe('Confirming...')
    expect(dialog.description.value).toBe('')
    expect(dialog.tone.value).toBe('default')
    const title = ref('Delete')
    const onClose = vi.fn()
    const key = consumer.openConfirmDialog({
      title,
      description: () => 'Permanent',
      confirmLabel: 'Delete',
      cancelLabel: 'Keep',
      pendingLabel: 'Deleting',
      tone: 'danger',
      onConfirm: vi.fn(),
      onClose,
    })
    title.value = 'Delete item'
    expect([
      dialog.title.value,
      dialog.description.value,
      dialog.confirmLabel.value,
      dialog.cancelLabel.value,
      dialog.pendingLabel.value,
      dialog.tone.value,
    ]).toEqual(['Delete item', 'Permanent', 'Delete', 'Keep', 'Deleting', 'danger'])
    consumer.closeConfirmDialog(key + 1)
    expect(dialog.dialogOpen.value).toBe(true)
    consumer.closeConfirmDialog()
    consumer.closeConfirmDialog()
    dialog.controller.closeConfirmDialog()
    expect(onClose).toHaveBeenCalledOnce()
    expect(dialog.dialogOpen.value).toBe(false)
    expect(dialog.title.value).toBe('Confirm action')
  })
  it('blocks duplicate submissions and respects external pending state and a false result', async () => {
    const { dialog, consumer } = setupDialog()
    await dialog.confirmDialog()
    const pending = ref(true)
    const result = Promise.withResolvers<boolean>()
    const onConfirm = vi.fn(() => result.promise)
    consumer.openConfirmDialog({ title: 'Save', description: '', pending, onConfirm })
    await dialog.confirmDialog()
    expect(onConfirm).not.toHaveBeenCalled()
    pending.value = false
    const confirming = dialog.confirmDialog()
    await dialog.confirmDialog()
    expect(onConfirm).toHaveBeenCalledOnce()
    expect(dialog.pending.value).toBe(true)
    result.resolve(false)
    await confirming
    expect(dialog.dialogOpen.value).toBe(true)
    expect(dialog.pending.value).toBe(false)
    onConfirm.mockResolvedValue(true)
    await dialog.confirmDialog()
    expect(dialog.dialogOpen.value).toBe(false)
  })
  it.each([new Error('Try again'), 'failure'])(
    'shows failures and clears them on retry',
    async (error) => {
      const { dialog, consumer } = setupDialog()
      const onConfirm = vi.fn().mockRejectedValueOnce(error).mockResolvedValueOnce(undefined)
      consumer.openConfirmDialog({ title: 'Save', description: '', onConfirm })
      await dialog.confirmDialog()
      expect(dialog.actionError.value).toBe(
        error instanceof Error ? 'Try again' : 'The action could not be completed.',
      )
      expect(dialog.pending.value).toBe(false)
      await dialog.confirmDialog()
      expect(dialog.actionError.value).toBe('')
      expect(dialog.dialogOpen.value).toBe(false)
    },
  )
  it.each(['resolve', 'reject'] as const)(
    'does not let an old action %s change its replacement',
    async (outcome) => {
      const { dialog, consumer } = setupDialog()
      const result = Promise.withResolvers<void>()
      const onClose = vi.fn()
      consumer.openConfirmDialog({
        title: 'Old',
        description: '',
        onConfirm: () => result.promise,
        onClose,
      })
      const confirming = dialog.confirmDialog()
      consumer.openConfirmDialog({ title: 'New', description: '', onConfirm: vi.fn() })
      expect(onClose).toHaveBeenCalledOnce()
      if (outcome === 'resolve') result.resolve()
      else result.reject(new Error('Old failure'))
      await confirming
      expect(dialog.title.value).toBe('New')
      expect(dialog.dialogOpen.value).toBe(true)
      expect(dialog.actionError.value).toBe('')
      expect(dialog.pending.value).toBe(false)
    },
  )
  it('closes owned dialogs on disposal and refuses new dialogs after disposal', () => {
    const { dialog, consumer, wrapper } = setupDialog()
    const onClose = vi.fn()
    const options = { title: 'Save', description: '', onConfirm: vi.fn(), onClose }
    consumer.openConfirmDialog(options)
    wrapper.unmount()
    expect(onClose).toHaveBeenCalledOnce()
    expect(dialog.dialogOpen.value).toBe(false)
    expect(consumer.openConfirmDialog(options)).toBe(0)
  })
})

function setupDialog() {
  let dialog!: ReturnType<typeof providePlatformConfirmDialog>
  let consumer!: ReturnType<typeof usePlatformConfirmDialog>
  const child = defineComponent({
    setup() {
      consumer = usePlatformConfirmDialog()
      return () => null
    },
  })
  const root = defineComponent({
    setup() {
      dialog = providePlatformConfirmDialog()
      return () => h(child)
    },
  })
  const wrapper = mount(root)
  wrappers.push(wrapper)
  return { dialog, consumer, wrapper }
}
