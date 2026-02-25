import type { HttpContext } from '@adonisjs/core/http'
import { CloudinaryService } from '#services/cloudinary_service'

export default class CloudinaryController {
    async sign({ request, response }: HttpContext) {
        const { folder } = request.only(['folder'])
        const service = new CloudinaryService()
        const params = service.generateSignedUploadParams(folder || 'reels')
        return response.ok(params)
    }
}