import { describe, expect, test } from 'vitest'
import { projectMailRecipients, projectMailSender, sanitizeMailBody } from '../src/mail.js'

describe('mail projection', () => {
  test('projects resolved and deterministic unknown parties', () => {
    const parties = {
      mailingListNames: new Map([[9, 'Operations']]),
      universeNames: new Map([
        [7, { name: 'Pilot', category: 'character' }],
        [8, { name: 'Wrong kind', category: 'alliance' }],
      ]),
    }
    expect(projectMailSender(7, parties)).toStrictEqual({ id: 7, name: 'Pilot', type: 'character' })
    expect(projectMailSender(10, parties)).toStrictEqual({ id: 10, name: null, type: 'unknown' })
    expect(
      projectMailRecipients(
        [
          { recipient_id: 8, recipient_type: 'corporation' },
          { recipient_id: 9, recipient_type: 'mailing_list' },
        ],
        parties,
      ),
    ).toStrictEqual([
      { id: 8, name: null, type: 'corporation' },
      { id: 9, name: 'Operations', type: 'mailing_list' },
    ])
  })

  test('retains only sanitized plain-text mail content', () => {
    expect(sanitizeMailBody('<b>Fly&nbsp;safe</b><br><url=showinfo:5>Link</url>')).toBe(
      'Fly safe\nLink',
    )
    expect(sanitizeMailBody('<font></font>&nbsp;')).toBeNull()
  })
})
