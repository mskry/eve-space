import { mountSuspended } from '@nuxt/test-utils/runtime'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { defineComponent, h, nextTick, ref } from 'vue'
import MailLabelAssignmentDialog from '../../app/components/mail/MailLabelAssignmentDialog.vue'
import MailLabelManagementDialog from '../../app/components/mail/MailLabelManagementDialog.vue'
import type { CreateMailLabelMutationParameters, MailLabel } from '../../app/queries/mail'

const labels: MailLabel[] = [
  { color: '#ffffff', labelId: 1, name: 'Inbox', unreadCount: 1 },
  { color: '#999999', labelId: 2, name: 'Archive', unreadCount: 0 },
]
const mountedWrappers: { unmount: () => void }[] = []

async function settle() {
  await nextTick()
  await new Promise((resolve) => setTimeout(resolve, 0))
  await nextTick()
}

afterEach(async () => {
  for (const wrapper of mountedWrappers.splice(0)) wrapper.unmount()
  await settle()
  document.body.replaceChildren()
})

describe('mail label dialogs', () => {
  it('validates creation, defaults visually to white, and identifies protected labels', async () => {
    const create = vi.fn()
    const remove = vi.fn()
    const Host = defineComponent({
      setup() {
        const name = ref('')
        const color = ref<CreateMailLabelMutationParameters['color']>()
        return () =>
          h(MailLabelManagementDialog, {
            color: color.value,
            createFeedback: '',
            creating: false,
            deletePendingIds: new Set<number>(),
            labels,
            name: name.value,
            open: true,
            undeletableLabelIds: new Set([1]),
            onCreate: create,
            onDelete: remove,
            'onUpdate:color': (value: string | undefined) => {
              color.value = value
            },
            'onUpdate:name': (value: string) => {
              name.value = value
            },
          })
      },
    })
    const wrapper = await mountSuspended(Host, { attachTo: document.body, route: false })
    mountedWrappers.push(wrapper)
    await settle()
    const dialog = document.querySelector<HTMLElement>('[role="dialog"]')!
    const input = dialog.querySelector<HTMLInputElement>('#mail-label-name')!
    const submit = [...dialog.querySelectorAll<HTMLButtonElement>('button')].find((button) =>
      button.textContent?.includes('CREATE LABEL'),
    )!

    expect(dialog.querySelectorAll('[role="radio"]')).toHaveLength(18)
    expect(
      dialog
        .querySelector('[role="radio"][aria-label="Label color #ffffff"]')
        ?.getAttribute('aria-checked'),
    ).toBe('true')
    expect(submit.disabled).toBe(true)
    expect(dialog.textContent).toContain('EVE PROTECTED')
    expect(dialog.querySelector('[aria-label="Delete Inbox"]')).toBeNull()

    input.value = 'x'.repeat(41)
    input.dispatchEvent(new Event('input', { bubbles: true }))
    await settle()
    expect(dialog.textContent).toContain('at most 40 characters')
    expect(submit.disabled).toBe(true)
    input.value = 'Priority'
    input.dispatchEvent(new Event('input', { bubbles: true }))
    dialog
      .querySelector<HTMLButtonElement>('[role="radio"][aria-label="Label color #fe0000"]')
      ?.click()
    await settle()
    submit.click()
    dialog.querySelector<HTMLButtonElement>('[aria-label="Delete Archive"]')?.click()

    expect(input.value).toBe('Priority')
    expect(create).toHaveBeenCalledOnce()
    expect(remove).toHaveBeenCalledWith(labels[1])
  })

  it('shows assignment state and emits complete chooser changes', async () => {
    const change = vi.fn()
    const wrapper = await mountSuspended(MailLabelAssignmentDialog, {
      attachTo: document.body,
      route: false,
      props: {
        assignedLabelIds: new Set([1]),
        feedback: 'Assignment refused.',
        labels,
        open: true,
        pending: false,
        onChange: change,
      },
    })
    mountedWrappers.push(wrapper)
    await settle()
    const dialog = document.querySelector<HTMLElement>('[role="dialog"]')!
    const checkboxes = [...dialog.querySelectorAll<HTMLInputElement>('input[type="checkbox"]')]

    expect(dialog.textContent).toContain('Assignment refused.')
    expect(checkboxes).toHaveLength(2)
    expect(checkboxes[0]?.checked).toBe(true)
    expect(checkboxes[1]?.checked).toBe(false)
    checkboxes[1]?.click()
    await settle()

    expect(change).toHaveBeenCalledWith(2, true)
    expect(checkboxes[1]?.checked).toBe(false)
  })
})
