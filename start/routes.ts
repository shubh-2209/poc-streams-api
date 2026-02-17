import router from '@adonisjs/core/services/router'
import { middleware } from '#start/kernel'

const AuthController = () => import('#controllers/auth_controller')
const VideosController = () => import('#controllers/videos_controller')
const AudioController = () => import('#controllers/audio_controller')

// ══════════════════════════════════════════════════════════════
// PUBLIC ROUTES
// ══════════════════════════════════════════════════════════════
router.group(() => {
  router.get('/health', async ({ response }) => {
    return response.ok({ status: 'ok', uptime: process.uptime(), pid: process.pid })
  })

  router.post('/auth/register', [AuthController, 'register'])
  router.post('/auth/login', [AuthController, 'login'])
  router.post('/auth/logout', [AuthController, 'logout']).use(middleware.auth())
}).prefix('/api')

// ══════════════════════════════════════════════════════════════
// PROTECTED ROUTES (Bearer token required)
// ══════════════════════════════════════════════════════════════
router.group(() => {

  router.get('/auth/me', [AuthController, 'me'])

  router.group(() => {
    router.get('/', [VideosController, 'index'])
    router.post('/upload', [VideosController, 'upload'])
    router.post('/upload-multiple', [VideosController, 'uploadMultiple'])
    router.get('/:id', [VideosController, 'show'])
    router.delete('/:id', [VideosController, 'destroy'])
    router.get('/:id/stream', [VideosController, 'stream'])
    router.get('/:id/status', [VideosController, 'status'])

    // Audio
    router.get('/:id/audio', [AudioController, 'download'])
    router.get('/:id/audio/clean', [AudioController, 'downloadClean'])
    router.post('/:id/audio/process', [AudioController, 'processAudio'])

    // ── NEW: Subtitles ──────────────────────────────────────────
    router.get('/:id/subtitles', [VideosController, 'downloadSubtitles'])

    // Convert an already-uploaded video (decompress → ffmpeg → compress)
    router.post('/convert', [VideosController, 'convert'])

    // Download a video (decompress on-the-fly, stream to client)
    router.get('/download/:fileName', [VideosController, 'download'])
        
  }).prefix('/videos')

}).prefix('/api')