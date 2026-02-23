import { HttpContext } from '@adonisjs/core/http'
import VideoFinalizeService from '#services/video_finalize_service'
import VideoThumbnailService from '#services/video_thumbnail_service'
import Video from '#models/video'
import { DateTime } from 'luxon'
import VideoTempManager from '#services/video_temp_manager_service'
import VideoProcessorService from '#services/video_processor_service'
import { uploadSprite, uploadVideoToCloudinary } from '#services/cloudinary_service'
import { Database } from '@adonisjs/lucid/database'
import { title } from 'process'
import SpriteService from '#services/sprite_service'

function formatTime(seconds: number) {
  const h = Math.floor(seconds / 3600)
  const m = Math.floor((seconds % 3600) / 60)
  const s = Math.floor(seconds % 60)

  if (h > 0) return `${h}:${m.toString().padStart(2,'0')}:${s.toString().padStart(2,'0')}`
  return `${m}:${s.toString().padStart(2,'0')}`
}

function buildThumbnails(frameCount: number, interval: number) {
  return Array.from({ length: frameCount }, (_, i) => {
    const timeSecond = Number((i * interval).toFixed(2))

    return {
      frameNo: i + 1,
      timeSecond,
      timeLabel: formatTime(timeSecond)
    }
  })
}

function calculateFrameCount(duration: number) {
  let frameCount: number
  let interval: number

  if (duration < 60) {
    frameCount = Math.ceil(duration/2)
    interval = 2
  } else if (duration < 600) {
    frameCount = Math.ceil(duration / 2)
    interval = 2
  } else if (duration < 3600) {
    frameCount = Math.ceil(duration / 5)
    interval = 5
  } else if (duration < 7200) {
    frameCount = Math.ceil(duration / 10)
    interval = 10
  } else {
    frameCount = 500
    interval = duration / 500
  }

  return { frameCount, interval }
}

function buildUploadResult({
  uploadedVideo,
  uploadedSprite,
  processed,
  originalFileName
}) {

  const { frameCount, interval } =  calculateFrameCount(processed.duration)

  const thumbnails = buildThumbnails(frameCount, interval)

  return {
    videoId: uploadedVideo.public_id,
    fileName: originalFileName,
    videoUrl: uploadedVideo.secure_url,
    posterUrl: '',
    duration: processed.duration,
    durationFormatted: formatTime(processed.duration),
    thumbnailCount: frameCount,
    interval,
    intervalLabel:
      interval === 1 ? '1 per second' : `every ${interval}s`,
    sprite: {
      path: uploadedSprite.url,
      columns: processed.spriteMeta.columns,
      rows: processed.spriteMeta.rows,
      thumbWidth: processed.spriteMeta.thumbWidth,
      thumbHeight: processed.spriteMeta.thumbHeight,
      spriteWidth:
        processed.spriteMeta.thumbWidth * processed.spriteMeta.columns,
      spriteHeight:
        processed.spriteMeta.thumbHeight * processed.spriteMeta.rows
    },
    thumbnails
  }
}


export default class VideoFinalizeController {

  async finalizeVideo({ request, response }: HttpContext) {
    const videoFile = request.file('video')
    if (!videoFile) {
      return response.badRequest({ success: false, message: 'No video file' })
    }

    let filters = null
    let trimData = null

    try {
      if (request.input('filters'))
        filters = JSON.parse(request.input('filters'))

      if (request.input('trimData'))
        trimData = JSON.parse(request.input('trimData'))
    } catch {
      return response.badRequest({ success: false, message: 'Invalid JSON' })
    }

    const temp = await VideoTempManager.create()
    const localVideoPath = await VideoTempManager.saveUploadedFile(videoFile, temp)
    console.log('save upload video file done');

    try {
      const processor = new VideoProcessorService()

      const processed = await processor.process({
        inputPath: localVideoPath,
        tempDir: temp,
        filters,
        trimData
      })

      console.log("process done")

      const uploadedVideo = await uploadVideoToCloudinary(processed.videoPath,"meri file")
      const uploadedSprite = await uploadSprite(processed.spritePath)

      const uploadResult = buildUploadResult({
        uploadedVideo,
        uploadedSprite,
        processed,
        originalFileName: videoFile.clientName
      })

      const extension =
        new URL(uploadedVideo.url).pathname.split('.').pop() || 'mp4'

      const video = await Video.create({
        userId: 1,
        title: videoFile.clientName,
        originalFilename: videoFile.clientName,
        storagePath: uploadedVideo.publicId,
        fileSize: uploadedVideo.bytes,
        mimeType: `video/${extension}`,
        status: 'uploaded',
        extension,
        uploadTime: DateTime.now(),
        uploadDuration: processed.duration,
        cloudinaryPublicId: uploadedVideo.publicId,
        cloudinaryUrl: uploadedVideo.url,
        cloudinaryStreamingUrl: uploadedVideo.url,
        type: 'video',
        video_thumbnails: uploadResult
      })

      let responseData ={
        video
      } 

      responseData.database = {
        id:video.id,
        title:video.title,
        status:video.status
      }

      return response.ok({
        success: true,
        message: 'Video uploaded and processed',
        data: responseData
      })
    } finally {
      await VideoTempManager.cleanup(temp)
    }
  }

  /**
   * Get video status
   * GET /api/v1/videos/:videoId
   */
  async getVideoDetails({ request, response }: HttpContext) {
    try {
      const videoId = request.param('videoId')

      if (!videoId) {
        return response.status(400).json({
          success: false,
          message: 'Video ID required',
        })
      }

      const video = await Video.find(videoId)

      if (!video) {
        return response.status(404).json({
          success: false,
          message: 'Video not found',
        })
      }

      return response.json({
        success: true,
        data: {
          id: video.id,
          title: video.title,
          url: video.cloudinaryUrl,
          streamingUrl: video.cloudinaryStreamingUrl,
          duration: video.duration,
          status: video.status,
          createdAt: video.createdAt,
        },
      })
    } catch (error: any) {
      return response.status(500).json({
        success: false,
        message: error.message,
      })
    }
  }

  async getProcessingStatus({ request, response }: HttpContext) {
    try {
      const videoId = request.param('videoId')

      if (!videoId) {
        return response.status(400).json({
          success: false,
          message: 'videoId is required',
        })
      }

      return response.json({
        success: true,
        data: {
          videoId,
          status: 'completed',
          progress: 100,
          message: 'Video processing completed',
        },
      })
    } catch (error: any) {
      return response.status(500).json({
        success: false,
        message: error.message,
      })
    }
  }

  /**
   * Cancel video processing
   * DELETE /api/v1/videos/:videoId/cancel
   */
  async cancelProcessing({ request, response }: HttpContext) {
    try {
      const videoId = request.param('videoId')

      if (!videoId) {
        return response.status(400).json({
          success: false,
          message: 'videoId is required',
        })
      }

      return response.json({
        success: true,
        message: 'Processing cancelled successfully',
        data: {
          videoId,
          cancelledAt: new Date().toISOString(),
        },
      })
    } catch (error: any) {
      return response.status(500).json({
        success: false,
        message: error.message,
      })
    }
  }
}