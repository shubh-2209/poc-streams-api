import { v2 as cloudinary } from 'cloudinary'
import env from '#start/env'

// Configure once on import
cloudinary.config({
    cloud_name: env.get('CLOUDINARY_CLOUD_NAME'),
    api_key: env.get('CLOUDINARY_API_KEY'),
    api_secret: env.get('CLOUDINARY_API_SECRET'),
})

export class CloudinaryService {
    /**
     * Generate a signed upload URL for direct browser → Cloudinary upload.
     * Backend NEVER touches the video binary — only metadata.
     */
    generateSignedUploadParams(folder: string = 'reels') {
        const timestamp = Math.round(Date.now() / 1000)

        const paramsToSign = {
            folder,
            timestamp,
        }

        const signature = cloudinary.utils.api_sign_request(
            paramsToSign,
            env.get('CLOUDINARY_API_SECRET')
        )

        return {
            signature,
            timestamp,
            api_key: env.get('CLOUDINARY_API_KEY'),
            cloud_name: env.get('CLOUDINARY_CLOUD_NAME'),
            folder,
            // Direct upload endpoint
            upload_url: `https://api.cloudinary.com/v1_1/${env.get('CLOUDINARY_CLOUD_NAME')}/video/upload`,
        }
    }

    /**
     * Get an HLS streaming URL for a Cloudinary video.
     * Cloudinary auto-transcodes to HLS when you request f_m3u8.
     */
    getHlsStreamingUrl(publicId: string): string {
        return cloudinary.url(publicId, {
            resource_type: 'video',
            format: 'm3u8',
            streaming_profile: 'hd',
            secure: true,
        })
    }
}