import { v2 as cloudinary } from 'cloudinary'
import crypto from 'crypto'
import env from '#start/env'

cloudinary.config({
  cloud_name: env.get('CLOUDINARY_CLOUD_NAME'),
  api_key: env.get('CLOUDINARY_API_KEY'),
  api_secret: env.get('CLOUDINARY_API_SECRET'),
})

interface UploadOptions {
  folder?: string
  public_id?: string
  overwrite?: boolean
  eager_async?: boolean
  eager?: any[]
}


function sanitizeFilename(filename: string): string {
  return (
    filename
      .replace(/\.[^/.]+$/, '')
      .replace(/[^a-zA-Z0-9_-]/g, '_')
      .replace(/_+/g, '_')
      .replace(/^_|_$/g, '')
      .substring(0, 100) || `video_${Date.now()}`
  )
}


export async function uploadVideoToCloudinary(
  filePath: string,
  originalName: string,
  options: UploadOptions = {}
) {
  const sanitizedName = sanitizeFilename(originalName)

 console.log(`📝 Original name: ${originalName}`)
  console.log(`✅ Sanitized name: ${sanitizedName}`)
  console.log(`📹 Uploading video: ${originalName} → ${sanitizedName}`)

  try {
    const result = await cloudinary.uploader.upload(filePath, {
      resource_type: 'video',
      folder: options.folder || 'streaming/videos',
      public_id: options.public_id || sanitizedName,
      overwrite: options.overwrite !== false,
      eager_async: options.eager_async !== false,
      eager: options.eager || [{ quality: 'auto', fetch_format: 'auto' }],
    })

    console.log('✅ Video uploaded successfully:', {
      public_id: result.public_id,
      duration: result.duration,
      format: result.format,
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
  } catch (error) {
    console.error('❌ Video upload failed:', error)
    throw error
  }
}

  export async function uploadGzipToCloudinary(filePath: string, originalName: string) {
    const sanitizedName = sanitizeFilename(originalName)
    console.log(`📦 Uploading gzip: ${originalName} → reels/compressed/${sanitizedName}.gz`)
  
    try {
      const result = await cloudinary.uploader.upload(filePath, {
        resource_type: 'raw',
        folder: 'reels/compressed',
        public_id: `${sanitizedName}.gz`,
        overwrite: true,
        access_mode: 'public', 
      })
    
      console.log(`✅ Gzip uploaded: ${result.secure_url}`)
      console.log(`✅ Public ID: ${result.public_id}`)
    
      return {
        url: result.secure_url,
        publicId: result.public_id,
        bytes: result.bytes,
      }
    } catch (error) {
      console.error('❌ Gzip upload failed:', error)
      throw error
    }
  }


  export function getGzipUrl(publicId: string): string {
    return cloudinary.url(publicId, {
      resource_type: 'raw',
      secure: true,
    })
  }

  export async function uploadSprite(spritePath: string) {
    console.log('🧩 Uploading sprite...')

    try {
      const result = await cloudinary.uploader.upload(spritePath, {
        resource_type: 'image',
        folder: 'streaming/sprites',
      })

      console.log('✅ Sprite uploaded:', result.public_id)

      return {
        url: result.secure_url,
        publicId: result.public_id,
        width: result.width,
        height: result.height,
      }
    } catch (error) {
      console.error('❌ Sprite upload failed:', error)
      throw error
    }
  }

  export async function deleteVideoFromCloudinary(publicId: string) {
    try {
      const result = await cloudinary.uploader.destroy(publicId, {
        resource_type: 'video',
      })
      console.log(`🗑️ Video deleted: ${publicId}`)
      return result
    } catch (error) {
      console.error('❌ Video deletion failed:', error)
      throw error
    }
  }

  export async function deleteGzipFromCloudinary(publicId: string) {
    try {
      const result = await cloudinary.uploader.destroy(publicId, {
        resource_type: 'raw',
      })
      console.log(`🗑️ Gzip deleted: ${publicId}`)
      return result
    } catch (error) {
      console.error('❌ Gzip deletion failed:', error)
      throw error
    }
  }

export default cloudinary