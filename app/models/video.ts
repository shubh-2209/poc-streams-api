import { DateTime } from 'luxon'
import { BaseModel, column, belongsTo } from '@adonisjs/lucid/orm'
import type { BelongsTo } from '@adonisjs/lucid/types/relations'
import User from '#models/user'

export default class Video extends BaseModel {
  @column({ isPrimary: true })
  declare id: number

  @column()
  declare userId: number

  @column()
  declare title: string

  @column()
  declare originalFilename: string

  @column()
  declare storagePath: string | null

  // Cloudinary fields
  @column()
  declare cloudinaryUrl: string | null

  @column()
  declare cloudinaryStreamingUrl: string | null

  @column()
  declare cloudinaryPublicId: string | null

  @column()
  declare audioPath: string | null

  @column()
  declare cleanAudioPath: string | null

  @column()
  declare thumbnailPath: string | null

  @column()
  declare subtitlePath: string | null

  @column()
  declare extension: string | null

  @column.dateTime()
  declare uploadTime: DateTime | null

  @column()
  declare uploadDuration: number | null

  @column.dateTime()
  declare processingStartedAt: DateTime | null

  @column.dateTime()
  declare processingCompletedAt: DateTime | null

  @column()
  declare fileSize: number

  @column()
  declare duration: number | null

  @column()
  declare resolution: string | null

  @column()
  declare mimeType: string

  @column()
  declare status: 'uploading' | 'uploaded' | 'processing' | 'ready' | 'failed' | 'compressing'

  @column()
  declare errorMessage: string | null

  @column.dateTime({ autoCreate: true })
  declare createdAt: DateTime

  @column.dateTime({ autoCreate: true, autoUpdate: true })
  declare updatedAt: DateTime

  @belongsTo(() => User)
  declare user: BelongsTo<typeof User>
}