import type { HttpContext } from '@adonisjs/core/http'
import { CloudinaryService } from '#services/cloudinary_service'

export default class CloudinaryController {
    async sign({ request, response }: HttpContext) {
        try {
            const { folder } = request.only(['folder'])
            const service = new CloudinaryService()
            const params = service.generateSignedUploadParams(folder || 'reels')
            return response.ok(params)
        } catch (error) {
            return response.internalServerError({
                message: 'Failed to generate signed URL',
                error: error.message,
            })
        }
    }
}