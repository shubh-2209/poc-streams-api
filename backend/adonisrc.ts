import { defineConfig } from '@adonisjs/core/app'

export default defineConfig({
  typescript: true,

  preloads: [
    () => import('./start/routes.js'),
    () => import('./start/kernel.js'),
  ],

  providers: [
    () => import('@adonisjs/core/providers/app_provider'),
    () => import('@adonisjs/core/providers/hash_provider'),
    () => import('@adonisjs/core/providers/vinejs_provider'),
    () => import('@adonisjs/cors/cors_provider'),
    () => import('@adonisjs/lucid/database_provider'),
    () => import('@adonisjs/auth/auth_provider'),
  ],

  commands: [
    () => import('@adonisjs/core/commands'),
    () => import('@adonisjs/lucid/commands'),
  ],

  directories: {
    config: 'config',
    commands: 'commands',
    contracts: 'contracts',
    public: 'public',
    providers: 'providers',
    languageFiles: 'resources/lang',
    migrations: 'database/migrations',
    seeders: 'database/seeders',
    factories: 'database/factories',
    views: 'resources/views',
    start: 'start',
    tmp: 'tmp',
    tests: 'tests',
  },
})