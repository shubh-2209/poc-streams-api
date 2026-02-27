import type { HttpContext } from '@adonisjs/core/http'
import Video from '#models/video'
import { CloudinaryService } from '#services/cloudinary_service'

export default class VideosController {
    async store({ request, auth, response }: HttpContext) {
        try {
            const user = auth.user
            if (!user) {
                return response.unauthorized({ message: 'Unauthorized' })
            }
            const { title, description, cloudinary_url, public_id, duration, format } = request.only([
                'title',
                'description',
                'cloudinary_url',
                'public_id',
                'duration',
                'format',
            ])

            if (!title || !cloudinary_url || !public_id) {
                return response.badRequest({
                    message: 'title, cloudinary_url and public_id are required',
                })
            }

            const cloudinaryService = new CloudinaryService()
            const hlsUrl = cloudinaryService.getHlsStreamingUrl(public_id)

            const video = await Video.create({
                userId: user.id,
                title,
                description: description || null,
                cloudinaryUrl: cloudinary_url,
                publicId: public_id,
                hlsUrl: hlsUrl,
                duration: duration || 0,
                format: format || 'mp4',
            })

            return response.created({
                message: 'Video saved successfully',
                video: {
                    id: video.id,
                    title: video.title,
                    description: video.description,
                    cloudinary_url: video.cloudinaryUrl,
                    hls_url: video.hlsUrl,
                    duration: video.duration,
                    format: video.format,
                    created_at: video.createdAt,
                },
            })
        } catch (error) {
            return response.internalServerError({
                message: 'Failed to save video',
                error: error.message,
            })
        }
    }

    async feed({ auth, response }: HttpContext) {
        try {
            const user = auth.user
            if (!user) {
                return response.unauthorized({ message: 'Unauthorized' })
            }

            const videos = await Video.query()
                .where('user_id', user.id)
                .orderBy('created_at', 'desc')
                .limit(20)

            return response.ok({
                videos: videos.map((v) => ({
                    id: v.id,
                    title: v.title,
                    description: v.description,
                    cloudinary_url: v.cloudinaryUrl,
                    hls_url: v.hlsUrl,
                    duration: v.duration,
                    format: v.format,
                    created_at: v.createdAt,
                })),
            })
        } catch (error) {
            return response.internalServerError({
                message: 'Failed to fetch feed',
                error: error.message,
            })
        }
    }

    async show({ params, response }: HttpContext) {
        try {
            const video = await Video.findOrFail(params.id)
            return response.ok({
                video: {
                    id: video.id,
                    title: video.title,
                    description: video.description,
                    cloudinary_url: video.cloudinaryUrl,
                    hls_url: video.hlsUrl,
                    duration: video.duration,
                    format: video.format,
                    created_at: video.createdAt,
                },
            })
        } catch (error) {
            return response.notFound({ message: 'Video not found' })
        }
    }
}