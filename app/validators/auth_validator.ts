import vine from '@vinejs/vine'
import { FieldContext } from '@vinejs/vine/types'

const passwordValidator = vine.createRule(async (value: unknown, _options: any, field: FieldContext) => {
  if (typeof value !== 'string') {
    field.report('Password must be a string', 'password', field)
    return
  }
  const errors: string[] = []

  if (value.length < 8) {
    errors.push('at least 8 characters')
  }

  if (value.length > 50) {
    errors.push('maximum 50 characters')
  }

  if (!/(?=.*[a-z])/.test(value)) {
    errors.push('one lowercase letter')
  }

  if (!/(?=.*[A-Z])/.test(value)) {
    errors.push('one uppercase letter')
  }

  if (!/(?=.*\d)/.test(value)) {
    errors.push('one number')
  }

  if (errors.length > 0) {
    field.report(
      `Password must contain: ${errors.join(', ')}`,
      'passwordStrength',
      field
    )
  }
})

export const registerValidator = vine.compile(
  vine.object({

    full_name: vine
      .string()
      .trim()
      .minLength(3)
      .maxLength(50)
      .regex(/^[a-zA-Z\s]+$/),

    email: vine
      .string()
      .email()
      .maxLength(100)
      .normalizeEmail(),

    password: vine
      .string()
      .use(passwordValidator()),
  })
)


export const loginValidator = vine.compile(
  vine.object({

    email: vine
      .string()
      .email()
      .maxLength(100)
      .normalizeEmail(),

    password: vine
      .string()
      .minLength(1)
      .maxLength(100),
  })
)
