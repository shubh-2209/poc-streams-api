import { v2 as cloudinary } from 'cloudinary'
import env from '#start/env'

cloudinary.config({
  cloud_name: env.get('CLOUDINARY_CLOUD_NAME'),
  api_key: env.get('CLOUDINARY_API_KEY'),
  api_secret: env.get('CLOUDINARY_API_SECRET'),
})

// ─── Helpers ──────────────────────────────────────────────────────────────────

function sanitizeFilename(filename: string): string {
  return filename
    .replace(/\.[^/.]+$/, '') 
    .replace(/[^a-zA-Z0-9_-]/g, '_') 
    .replace(/_+/g, '_') 
    .replace(/^_|_$/g, '') 
    .substring(0, 100) 
    || `video_${Date.now()}`
}


export async function uploadVideoToCloudinary(filePath: string, originalName: string) {
    const sanitizedName = sanitizeFilename(originalName)

    console.log(`📝 Original name: ${originalName}`)
    console.log(`✅ Sanitized name: ${sanitizedName}`)

    console.log(`📹 Uploading video: ${originalName} → ${sanitizedName}`)

    const result = await cloudinary.uploader.upload(filePath, {
      resource_type: 'video',
      folder: 'reels',
      public_id: sanitizedName,
      overwrite: true,
      transformation: [
        { quality: 'auto', fetch_format: 'auto' },
      ],
    })

    const streamingUrl = cloudinary.url(result.public_id, {
      resource_type: 'video',
      streaming_profile: 'auto',
      format: 'm3u8', 
      secure: true,
    })

    return {
      url: result.secure_url,
      streamingUrl: streamingUrl,
      publicId: result.public_id,
      duration: result.duration,
      format: result.format,
      bytes: result.bytes,
    }
  }

  export async function uploadGzipToCloudinary(filePath: string, originalName: string) {
    const sanitizedName = sanitizeFilename(originalName)
    console.log(`📦 Uploading gzip: ${originalName} → reels/compressed/${sanitizedName}.gz`)

    const result = await cloudinary.uploader.upload(filePath, {
      resource_type: 'raw',
      folder:        'reels/compressed',
      public_id:     `${sanitizedName}.gz`,
      overwrite:     true,
      access_mode:   'public',             // ← fix: makes raw file fetchable without auth
    })

    console.log(`✅ Gzip uploaded: ${result.secure_url}`)
    console.log(`✅ Public ID: ${result.public_id}`)

    return {
      url:      result.secure_url,
      publicId: result.public_id,
      bytes:    result.bytes,
    }
  }


  export function getGzipUrl(publicId: string): string {
    return cloudinary.url(publicId, {
      resource_type: 'raw',
      secure:        true,
    })
  }


  export async function deleteVideoFromCloudinary(publicId: string) {
    return cloudinary.uploader.destroy(
      publicId, 
      { resource_type: 'video' }
    )
  }

  export async function deleteGzipFromCloudinary(publicId: string) {
    return cloudinary.uploader.destroy(
      publicId, 
      { resource_type: 'raw' }
    )
  }

export default cloudinary