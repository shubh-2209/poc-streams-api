import type { HttpContext } from '@adonisjs/core/http'
import VideoThumbnailService from '#services/video_thumbnail_service'
import ResponseHelper from '../utils/response_helper.js'
// Module-level instantiation (AdonisJS v6 me constructor kaam nahi karta)
const videoThumbnailService = new VideoThumbnailService()

export default class VideoThumbnailController {
  // POST /api/v1/upload
  async uploadVideo({ request, response, i18n }: HttpContext) {
    try {
      const videoFile = request.file('video')

      if (!videoFile) {
        return ResponseHelper.badRequest(response, i18n.t('thumbnail.no_video_provided'))
      }

      const customThumbnailFile = request.file('thumbnail') ?? undefined

      const result = await videoThumbnailService.processVideoUpload(videoFile, customThumbnailFile)

      return ResponseHelper.success(response, i18n.t('thumbnail.video_processed'), result)
    } catch (error: any) {
      return ResponseHelper.serverError(response, i18n.t('thumbnail.processing_failed'), error)
    }
  }

  // GET /api/v1/videos/:id/thumbnails
  async getThumbnails({ params, response ,i18n }: HttpContext) {
    try {
      const files = await videoThumbnailService.getVideoFiles(params.id)

      return ResponseHelper.success(response, i18n.t('thumbnail.thumbnails_fetched'), {
        count: files.length,
        files,
      })
    } catch (error: any) {
      return ResponseHelper.notFound(response, i18n.t('thumbnail.video_folder_not_found'), error)
    }
  }

  // GET /api/v1/videos

async getVideos({ response, i18n }: HttpContext) {
  try {
    const videos = await videoThumbnailService.getAllVideos()

    return ResponseHelper.success(
      response,
      '',
      {
        count: videos.length,
        data: videos,
      }
    )
  } catch (error: any) {
    return ResponseHelper.success(
      response,
      i18n.t('thumbnail.no_videos_yet'),
      {
        count: 0,
        data: [],
      }
    )
  }
}
