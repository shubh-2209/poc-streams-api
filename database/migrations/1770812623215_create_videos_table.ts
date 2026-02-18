// database/migrations/create_videos_table.ts
import { BaseSchema } from '@adonisjs/lucid/schema'

export default class extends BaseSchema {
  protected tableName = 'videos'

  async up() {
    this.schema.createTable(this.tableName, (table) => {
      table.increments('id')

      // Owner
      table.integer('user_id').unsigned().references('id').inTable('users').onDelete('CASCADE')

      // File info
      table.string('title').notNullable()
      table.string('original_filename').notNullable()

      /**
       * storage_path — relative path inside uploads folder (local)
       * Example: "videos/1/1707123456789.mp4"
       * For S3: same path but inside S3 bucket
       */
      table.string('storage_path').notNullable()
      table.string('audio_path').nullable()          // extracted raw audio .mp3
      table.string('clean_audio_path').nullable()    // noise-cancelled audio .mp3
      table.string('thumbnail_path').nullable()      // video thumbnail .jpg

      // Metadata
      table.bigInteger('file_size').unsigned().defaultTo(0)   // bytes
      table.integer('duration').nullable()                    // seconds
      table.string('resolution').nullable()                   // "1920x1080"
      table.string('mime_type').defaultTo('video/mp4')

      /**
       * Status pipeline:
       * uploading → uploaded → processing → ready
       *                                  ↘ failed
       */
      table.enum('status', [
        'uploading',
        'uploaded',
        'processing',
        'ready',
        'failed',
        'compressing'
      ]).defaultTo('uploading')

      table.text('error_message').nullable()  // store error if failed

      table.timestamp('created_at').notNullable()
      table.timestamp('updated_at').notNullable()
    })
  }

  async down() {
    this.schema.dropTable(this.tableName)
  }
}