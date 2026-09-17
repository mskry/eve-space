import { describe, expect, test } from 'vitest'
import { projectMailRecipients, projectMailSender, sanitizeMailBody } from '../src/mail.js'

describe('mail projection', () => {
  test('projects resolved and deterministic unknown parties', () => {
    const parties = {
      universeNames: new Map([
        [7, { name: 'Pilot', category: 'character' }],
        [8, { name: 'Wrong kind', category: 'alliance' }],
      ]),
      mailingListNames: new Map([[9, 'Operations']]),
    }
    expect(projectMailSender(7, parties)).toEqual({ id: 7, type: 'character', name: 'Pilot' })
    expect(projectMailSender(10, parties)).toEqual({ id: 10, type: 'unknown', name: null })
    expect(
      projectMailRecipients(
        [
          { recipient_id: 8, recipient_type: 'corporation' },
          { recipient_id: 9, recipient_type: 'mailing_list' },
        ],
        parties,
      ),
    ).toEqual([
      { id: 8, type: 'corporation', name: null },
      { id: 9, type: 'mailing_list', name: 'Operations' },
    ])
  })

  test('retains only sanitized plain-text mail content', () => {
    expect(sanitizeMailBody('<b>Fly&nbsp;safe</b><br><url=showinfo:5>Link</url>')).toBe(
      'Fly safe\nLink',
    )
    expect(sanitizeMailBody('<font></font>&nbsp;')).toBeNull()
  })
})
