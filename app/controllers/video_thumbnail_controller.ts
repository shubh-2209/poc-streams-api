import type { HttpContext } from '@adonisjs/core/http'
import VideoThumbnailService from '#services/video_thumbnail_service'

// Module-level instantiation (AdonisJS v6 me constructor kaam nahi karta)
const videoThumbnailService = new VideoThumbnailService()

export default class VideoThumbnailController {

    // POST /api/v1/upload
    async uploadVideo({ request, response }: HttpContext) {
        try {
            const videoFile = request.file('video')

            if (!videoFile) {
                return response.status(400).json({
                    success: false,
                    message: 'No video file provided',
                })
            }

            const customThumbnailFile = request.file('thumbnail') ?? undefined

            const result = await videoThumbnailService.processVideoUpload(
                videoFile,
                customThumbnailFile
            )

            return response.json({
                success: true,
                message: 'Video processed successfully',
                data: result,
            })
        } catch (error: any) {
            console.error('❌ Upload error:', error)
            return response.status(500).json({
                success: false,
                message: error.message,
            })
        }
    }

    // GET /api/v1/videos/:id/thumbnails
    async getThumbnails({ params, response }: HttpContext) {
        try {
            const files = await videoThumbnailService.getVideoFiles(params.id)

            return response.json({
                success: true,
                count: files.length,
                data: files,
            })
        } catch (error: any) {
            return response.status(404).json({
                success: false,
                message: 'Video folder not found',
            })
        }
    }

    // GET /api/v1/videos
    async getVideos({ response }: HttpContext) {
        try {
            const videos = await videoThumbnailService.getAllVideos()

            return response.json({
                success: true,
                count: videos.length,
                data: videos,
            })
        } catch (error: any) {
            return response.json({
                success: true,
                count: 0,
                data: [],
                message: 'No videos processed yet',
            })
        }
    }
}