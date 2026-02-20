import { BaseSchema } from '@adonisjs/lucid/schema'
 
export default class extends BaseSchema {
  protected tableName = 'videos'
 
  async up() {
    this.schema.alterTable(this.tableName, (table) => {
      table.json('video_thumbnails').nullable()
    })
  }
 
  async down() {
    this.schema.alterTable(this.tableName, (table) => {
      table.dropColumn('video_thumbnails')
    })  }
}
 