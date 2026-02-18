import vine from '@vinejs/vine'

export const videoUploadValidator = vine.compile(
  vine.object({
    title: vine
      .string()
      .trim()
      .minLength(3)
      .maxLength(100),
  })
)

const messages = {
  'title.required': 'Video title is required',
  'title.minLength': 'Title must be at least 3 characters',
  'title.maxLength': 'Title must not exceed 100 characters',
}
