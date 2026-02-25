import type { HttpContext } from '@adonisjs/core/http'
import Video from '#models/video'
import { CloudinaryService } from '#services/cloudinary_service'

export default class VideosController {
    async store({ request, auth, response }: HttpContext) {
        const user = auth.user!
        const { title, description, cloudinary_url, public_id, duration, format } =
            request.only(['title', 'description', 'cloudinary_url', 'public_id', 'duration', 'format'])

        const cloudinary = new CloudinaryService()

        const video = await Video.create({
            userId: user.id,
            title,
            description,
            cloudinaryUrl: cloudinary_url,
            publicId: public_id,
            hlsUrl: cloudinary.getHlsUrl(public_id), // Cloudinary HLS URL
            duration: duration ?? 0,
            format: format ?? 'mp4',
        })

        return response.created({ video })
    }

    async feed({ response }: HttpContext) {
        const videos = await Video.query()
            .orderBy('created_at', 'desc')
            .preload('user')
            .limit(20)

        return response.ok({ videos })
    }

    async show({ params, response }: HttpContext) {
        const video = await Video.findOrFail(params.id)
        return response.ok({ video })
    }
}