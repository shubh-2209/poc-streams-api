import { BaseSchema } from '@adonisjs/lucid/schema'

export default class extends BaseSchema {
  protected tableName = 'videos'

  async up() {
    this.schema.createTable(this.tableName, (table) => {
      table.increments('id')
      table.integer('user_id').unsigned().references('id').inTable('users').onDelete('CASCADE')
      table.string('title').notNullable()
      table.text('description').nullable()
      table.string('cloudinary_url').notNullable()
      table.string('public_id').notNullable()
      table.string('hls_url').nullable()
      table.float('duration').defaultTo(0)
      table.string('format').defaultTo('mp4')
      table.timestamp('created_at')
      table.timestamp('updated_at')
    })
  }

  async down() {
    this.schema.dropTable(this.tableName)
  }
}