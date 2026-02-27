import router from '@adonisjs/core/services/router'
import { middleware } from './kernel.js'

const AuthController = () => import('#controllers/auth_controller')
const VideosController = () => import('#controllers/videos_controller')
const CloudinaryController = () => import('#controllers/cloudinary_controller')

// ─── Health Check (public) ────────────────────────────────────────────────────
router.get('/', async ({ response }) => {
    return response.ok({ status: 'ok', message: 'Reels API is running' })
})

// ─── Auth Routes (public — no token needed) ───────────────────────────────────
router.post('/api/auth/register', [AuthController, 'register'])
router.post('/api/auth/login', [AuthController, 'login'])

// ─── Protected Routes (require Bearer token) ─────────────────────────────────
router
    .group(() => {
        // Auth
        router.get('/api/auth/me', [AuthController, 'me'])
        router.delete('/api/auth/logout', [AuthController, 'logout'])

        // Cloudinary — get signed upload URL
        router.post('/api/cloudinary/sign', [CloudinaryController, 'sign'])

        // Videos
        router.post('/api/videos', [VideosController, 'store'])
        router.get('/api/videos/feed', [VideosController, 'feed'])
        router.get('/api/videos/:id', [VideosController, 'show'])
    })
    .use(middleware.auth({ guards: ['api'] }))

// ─── Serve local HLS files (Phase 2/3) ───────────────────────────────────────
router.get('/hls/*', async ({ request, response }) => {
    const filePath = request.url().replace('/hls', '')
    return response.download(`storage/hls${filePath}`)
})