import { describe, expect, it } from 'vitest'

import { validationResponse } from '@/lib/validation-errors'

/**
 * Field-level validation messages in a refused write's REST response.
 *
 * Payload's `formatErrors` only includes a ValidationError's per-field messages when
 * `err instanceof ValidationError`. The production bundle holds more than one copy of that class,
 * so the check fails and the admin gets only the summary ("The following field is invalid:
 * Phone") — never the validator's sentence. These errors are recognised by SHAPE instead: their
 * name comes from `this.constructor.name`, which a minifier may rename.
 */

/** What Payload's ValidationError carries, built without the class — as the bundle sees it. */
const refused = (errors: unknown[], overrides: Record<string, unknown> = {}) =>
  Object.assign(new Error('The following field is invalid: Phone'), {
    status: 400,
    isPublic: true,
    data: { collection: 'settings', errors },
    ...overrides,
  })

const phone = {
  path: 'contact.phone',
  label: 'Phone',
  message: 'Use a phone number people can dial, like (843) 555-0100, without an extension.',
}

describe('validationResponse', () => {
  it('restores the per-field messages the admin form shows at each field', () => {
    expect(validationResponse(refused([phone]))).toEqual({
      errors: [
        {
          name: 'ValidationError',
          message: 'The following field is invalid: Phone',
          data: { collection: 'settings', errors: [phone] },
        },
      ],
    })
  })

  it('keeps every field when several are refused', () => {
    const email = { path: 'contact.email', message: 'Use one email address.' }
    const response = validationResponse(refused([phone, email]))
    expect(response?.errors[0]?.data.errors).toEqual([phone, email])
  })

  it.each([
    ['not a 400', refused([phone], { status: 500 })],
    ['not public', refused([phone], { isPublic: false })],
    ['no field errors', refused([])],
    ['field errors without a path', refused([{ message: 'Something' }])],
    ['field errors without a message', refused([{ path: 'title' }])],
    ['no data at all', Object.assign(new Error('Forbidden'), { status: 403, isPublic: true })],
  ])('leaves anything else to Payload — %s', (_label, error) => {
    expect(validationResponse(error)).toBeUndefined()
  })

  it('leaves non-errors alone', () => {
    expect(validationResponse(undefined)).toBeUndefined()
    expect(validationResponse('a string')).toBeUndefined()
  })
})
