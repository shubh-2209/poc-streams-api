import { DateTime } from 'luxon'
import { BaseModel, column, belongsTo } from '@adonisjs/lucid/orm'
import type { BelongsTo } from '@adonisjs/lucid/types/relations'
import User from '#models/user'

export default class Video extends BaseModel {
    @column({ isPrimary: true })
    declare id: number

    @column({ columnName: 'user_id' })
    declare userId: number

    @column()
    declare title: string

    @column()
    declare description: string | null

    @column({ columnName: 'cloudinary_url' })
    declare cloudinaryUrl: string

    @column({ columnName: 'public_id' })
    declare publicId: string

    @column({ columnName: 'hls_url' })
    declare hlsUrl: string | null

    @column()
    declare duration: number

    @column()
    declare format: string

    @column.dateTime({ autoCreate: true })
    declare createdAt: DateTime

    @column.dateTime({ autoCreate: true, autoUpdate: true })
    declare updatedAt: DateTime

    @belongsTo(() => User)
    declare user: BelongsTo<typeof User>
}