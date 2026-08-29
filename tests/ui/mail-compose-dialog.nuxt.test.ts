import { mountSuspended } from '@nuxt/test-utils/runtime'
import { afterEach, describe, expect, it } from 'vitest'
import { nextTick } from 'vue'
import MailComposeDialog from '../../app/components/mail/MailComposeDialog.vue'

const mountedWrappers: { unmount: () => void }[] = []

afterEach(() => {
  for (const wrapper of mountedWrappers.splice(0)) wrapper.unmount()
  document.body.replaceChildren()
})

describe('MailComposeDialog', () => {
  it('renders composition state, updates models, and emits every user action', async () => {
    const wrapper = await mountDialog()
    const recipient = { id: 44, name: 'Wingmate', type: 'character' as const }

    expect(document.body.textContent).toContain('Compose new mail')
    expect(document.body.textContent).toContain('Omitted Pilot')
    expect(document.body.textContent).toContain('Authorize search')
    expect(document.body.textContent).toContain('Authorize character')

    getButton('Remove Wingmate').click()
    getButton('Suggestion Corp').click()
    getButton('CHECK RECIPIENT CHARGE').click()
    getButton('SEND MAIL').click()
    getButton('CANCEL').click()
    document.querySelector('form')?.dispatchEvent(new SubmitEvent('submit', { bubbles: true }))
    await nextTick()

    expect(wrapper.emitted('removeRecipient')?.[0]).toEqual([recipient])
    expect(wrapper.emitted('addRecipient')?.[0]).toEqual([
      { id: 91, name: 'Suggestion Corp', type: 'corporation' },
    ])
    expect(wrapper.emitted('recoverCharge')).toHaveLength(1)
    expect(wrapper.emitted('send')).toHaveLength(1)
    expect(wrapper.emitted('close')).toHaveLength(1)
    expect(wrapper.emitted('resolveRecipient')).toHaveLength(1)

    await wrapper.setProps({ mode: 'reply' })
    expect(document.body.textContent).toContain('Reply to message')
    await wrapper.setProps({ mode: 'reply-all' })
    expect(document.body.textContent).toContain('Reply to all')
    await wrapper.setProps({ mode: 'forward' })
    expect(document.body.textContent).toContain('Forward message')
  })

  it('renders pending, empty-suggestion, disabled, and over-limit states', async () => {
    const wrapper = await mountDialog({
      bodyRemaining: -1,
      chargeRecoveryAvailable: false,
      feedback: '',
      omitted: [],
      recipients: [],
      resolving: true,
      searching: true,
      sendAuthorizationMessage: undefined,
      sendAuthorizationUrl: undefined,
      sendDisabledReason: 'Add at least one recipient.',
      sending: true,
      subjectRemaining: -1,
      suggestions: [],
    })

    expect(document.body.textContent).toContain('Searching recipients...')
    expect(document.body.textContent).toContain('RESOLVING...')
    expect(document.body.textContent).toContain('SENDING...')
    expect(getButton('SEND MAIL', 'SENDING...').disabled).toBe(true)
    expect(document.querySelectorAll('.is-over-limit')).toHaveLength(2)
    expect(wrapper.emitted('recoverCharge')).toBeUndefined()
  })
})

async function mountDialog(overrides: Record<string, unknown> = {}) {
  const wrapper = await mountSuspended(MailComposeDialog, {
    attachTo: document.body,
    props: {
      body: 'Message body',
      bodyRemaining: 9_988,
      chargeRecoveryAvailable: true,
      feedback: 'Provider feedback',
      mode: 'new',
      omitted: ['Omitted Pilot'],
      open: true,
      recipientInput: 'Wingmate',
      recipients: [{ id: 44, name: 'Wingmate', type: 'character' }],
      resolving: false,
      searchAuthorizationMessage: 'Authorize recipient search.',
      searchAuthorizationUrl: '/authorize-search',
      searching: false,
      sendAuthorizationMessage: 'Authorize mail sending.',
      sendAuthorizationUrl: '/authorize-send',
      sendDisabledReason: '',
      sending: false,
      subject: 'Subject',
      subjectRemaining: 993,
      suggestions: [{ id: 91, name: 'Suggestion Corp', type: 'corporation' }],
      ...overrides,
    },
  })
  mountedWrappers.push(wrapper)
  return wrapper
}

function getButton(ariaLabel: string, text = ariaLabel) {
  const button = [...document.querySelectorAll('button')].find(
    (candidate) =>
      candidate.getAttribute('aria-label') === ariaLabel || candidate.textContent?.includes(text),
  )
  expect(button, `button ${ariaLabel} was not rendered`).toBeDefined()
  return button as HTMLButtonElement
}
