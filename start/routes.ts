import router from '@adonisjs/core/services/router'
import { middleware } from '#start/kernel'

const AuthController = () => import('#controllers/auth_controller')
const VideosController = () => import('#controllers/videos_controller')
const AudioController = () => import('#controllers/audio_controller')
const VideoThumbnailController = () => import('#controllers/video_thumbnail_controller')
const VideoFinalizeController = () => import('#controllers/video_finalizes_controller')


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
  
  router.group(() => {
  router.get('/auth/me', [AuthController, 'me'])
            }).use(middleware.auth({ guards: ['api'] })) 
}).prefix('/api')
  
router.group(() => {

  router.post('/upload', [VideoThumbnailController, 'uploadVideo'])
  router.get('/videos', [VideoThumbnailController, 'getVideos'])
  router.get('/videos/:id/thumbnails', [VideoThumbnailController, 'getThumbnails'])

}).prefix('/api/v1') 

// ══════════════════════════════════════════════════════════════
// PROTECTED ROUTES (Bearer token required)
// ══════════════════════════════════════════════════════════════
router.group(() => {

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
    
    router.post('/upload-video-convert',[VideosController,'uploadVideoConvert'])
    
    // Download a video (decompress on-the-fly, stream to client)
    router.get('/:id/download', [VideosController, 'download'])
    
  }).prefix('/videos')

}).prefix('/api')

// routes/live_streams.ts
const LiveStreamsController = () => import('#controllers/live_streams_controller')
  router
    .group(() => {
      // Start a new live stream
      router.post('/start', [LiveStreamsController, 'start'])

      // Receive video chunks during streaming
      router.post('/:sessionId/chunk', [LiveStreamsController, 'receiveChunk'])

      // End live stream and save to database
      router.post('/:sessionId/end', [LiveStreamsController, 'end'])

      // Cancel live stream
      router.post('/:sessionId/cancel', [LiveStreamsController, 'cancel'])

      // Get user's videos
      router.get('/my-videos', [LiveStreamsController, 'getMyVideos'])

      // Get single video
      router.get('/videos/:videoId', [LiveStreamsController, 'getVideo'])

      // Delete video
      router.delete('/videos/:videoId', [LiveStreamsController, 'deleteVideo'])
    })
    .prefix('/api/live-streams')

  router.group(()=>{
    router.post('/videos/finalize', [VideoFinalizeController, 'finalizeVideo'])
    router.get('/videos/:videoId/status', [VideoFinalizeController, 'getProcessingStatus'])
    router.delete('/videos/:videoId/cancel', [VideoFinalizeController, 'cancelProcessing'])
  })
  .prefix('/api/v1')