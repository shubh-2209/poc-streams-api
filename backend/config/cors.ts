import { defineConfig } from '@adonisjs/cors'

/**
 * Configuration options to tweak the CORS policy. The following
 * options are documented on the official documentation website.
 *
 * https://docs.adonisjs.com/guides/security/cors
 */
const corsConfig = defineConfig({
  enabled: true,
  origin: true,
  methods: ['GET', 'HEAD', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  headers: true,
  exposeHeaders: ['cache-control', 'content-language', 'content-type', 'expires', 'last-modified'],
  credentials: true,
  maxAge: 90,
})

export default corsConfig