import router from '@adonisjs/core/services/router'
import { middleware } from './kernel.js'

const AuthController = () => import('#controllers/auth_controller')
const VideosController = () => import('#controllers/videos_controller')
const CloudinaryController = () => import('#controllers/cloudinary_controller')

// Auth routes (public)
router.post('/api/auth/register', [AuthController, 'register'])
router.post('/api/auth/login', [AuthController, 'login'])

// Protected routes
router
    .group(() => {
        router.post('/api/cloudinary/sign', [CloudinaryController, 'sign'])
        router.post('/api/videos', [VideosController, 'store'])
        router.get('/api/videos/feed', [VideosController, 'feed'])
        router.get('/api/videos/:id', [VideosController, 'show'])
    })
    .use(middleware.auth({ guards: ['api'] }))

// Serve local HLS files for Phase 2/3 (static)
router.get('/hls/*', async ({ request, response }) => {
    const filePath = request.url().replace('/hls', '')
    return response.download(`storage/hls${filePath}`)
})