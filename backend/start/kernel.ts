import router from '@adonisjs/core/services/router'
import server from '@adonisjs/core/services/server'

/**
 * Global exception handler — always returns JSON, never HTML
 */
server.errorHandler(() => import('#exceptions/handler'))

server.use([
  () => import('@adonisjs/core/bodyparser_middleware'),
  () => import('@adonisjs/cors/cors_middleware'),
])

router.use([
  () => import('@adonisjs/auth/initialize_auth_middleware'),  // ← THIS WAS MISSING
])
/**
 * Named middleware — assigned explicitly to routes
 */
export const middleware = router.named({
  auth: () => import('#middleware/auth_middleware'),
})