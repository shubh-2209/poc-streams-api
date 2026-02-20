import { BaseSchema } from '@adonisjs/lucid/schema'

export default class extends BaseSchema {
  protected tableName = 'live_chats'

  async up() {
    this.schema.createTable(this.tableName, (table) => {
      table.increments('id')

      table.string('session_id').notNullable().index()

      table.integer('video_id').unsigned().references('id').inTable('videos').onDelete('CASCADE')

      table.string('username').notNullable()
      table.text('message').notNullable()

      table.timestamp('created_at', { useTz: true }).notNullable().defaultTo(this.now())

      table.timestamp('updated_at', { useTz: true }).notNullable().defaultTo(this.now())
    })
  }

  async down() {
    this.schema.dropTable(this.tableName)
  }
}
