import { BaseSeeder } from '@adonisjs/lucid/seeders'
import User from '#models/user'
import Hash from '@adonisjs/core/services/hash'

export default class extends BaseSeeder {
  public async run() {

    await User.createMany([
      {
        fullName: 'Admin User',
        email: 'admin@gmail.com',
        password: await Hash.make('admin123'),
      },
      {
        fullName: 'Test User',
        email: 'test@gmail.com',
        password: await Hash.make('test123'),
      }
    ])

  }
}
