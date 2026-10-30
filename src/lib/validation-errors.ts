/**
 * Field-level validation messages for a refused write's REST response.
 *
 * Every "say it in words" validator in the admin — the phone number, the theme's contrast
 * check, the password policy — throws a ValidationError whose `data.errors` names each field
 * and why. Payload's `formatErrors` passes that through only when `err instanceof
 * ValidationError`, and the production bundle holds more than one copy of the class, so the check
 * fails: the admin form got the summary ("The following field is invalid: Phone") as a toast and
 * never the sentence at the field.
 *
 * Recognised by SHAPE, not by class or name: `name` is `this.constructor.name`, which a minifier
 * may rename. Applied as the config's `afterError` hook (`src/payload.config.ts`). Anything that
 * is not a public 400 carrying per-field messages is left to Payload's own response.
 */

export type FieldError = { path: string; message: string } & Record<string, unknown>

export type ValidationResponse = {
  errors: { name: 'ValidationError'; message: string; data: { errors: FieldError[] } }[]
}

const isFieldError = (value: unknown): value is FieldError =>
  typeof value === 'object' &&
  value !== null &&
  typeof (value as { path?: unknown }).path === 'string' &&
  typeof (value as { message?: unknown }).message === 'string'

export const validationResponse = (error: unknown): ValidationResponse | undefined => {
  if (!(error instanceof Error)) return undefined
  const { status, isPublic, data } = error as Error & {
    status?: unknown
    isPublic?: unknown
    data?: unknown
  }
  if (status !== 400 || isPublic !== true) return undefined
  if (typeof data !== 'object' || data === null) return undefined
  const errors = (data as { errors?: unknown }).errors
  if (!Array.isArray(errors) || errors.length === 0 || !errors.every(isFieldError)) return undefined

  return {
    errors: [
      {
        name: 'ValidationError',
        message: error.message,
        data: data as { errors: FieldError[] },
      },
    ],
  }
}
