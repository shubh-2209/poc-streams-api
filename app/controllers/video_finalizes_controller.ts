import { HttpContext } from '@adonisjs/core/http'
import VideoFinalizeService from '#services/video_finalize_service'
import VideoThumbnailService from '#services/video_thumbnail_service'
import Video from '#models/video'
import { DateTime } from 'luxon'

export default class VideoFinalizeController {


  /**
   * Combined Single Endpoint: Upload + Process + Finalize
   * POST /api/v1/videos/finalize
   * 
   * This endpoint handles:
   * 1. Video upload to Cloudinary (if video file provided)
   * 2. Sprite generation for thumbnails
   * 3. Optional: Apply filters and trim
   * 4. Save to database
   * 
   * Can be called in two ways:
   * - With just video file → Upload and generate sprites
   * - With video file + filters + trimData → Upload, process, and finalize
   */
   async finalizeVideo({ request, response }: HttpContext) {
    try {
      console.log('📨 Received finalize request')

      // ============ GET VIDEO FILE ============
      const videoFile = request.file('video')

      if (!videoFile) {
        return response.status(400).json({
          success: false,
          message: 'No video file provided',
        })
      }

      console.log('📤 Video file received:', {
        name: videoFile.clientName,
        size: videoFile.size,
      })

      // ============ STEP 1: UPLOAD & GENERATE SPRITES ============
      console.log('🎬 Uploading video and generating sprites...')

      const videoThumbnailService = new VideoThumbnailService()
      const uploadResult = await videoThumbnailService.processVideoUpload(videoFile)

      console.log('✅ Original video uploaded')
      console.log('   Video ID:', uploadResult.videoId)
      console.log('   Duration:', uploadResult.duration)

      // ============ STEP 2: GET FILTERS & TRIM ============
      const filtersStr = request.input('filters')
      const trimDataStr = request.input('trimData')

      let filters = null
      let trimData = null
      let finalizeResult = null

      if (filtersStr && trimDataStr) {
        try {
          filters = JSON.parse(filtersStr)
          trimData = JSON.parse(trimDataStr)
          console.log('✅ Parsed filters and trimData')
        } catch (parseError) {
          return response.status(400).json({
            success: false,
            message: 'Invalid JSON in filters or trimData',
          })
        }

        // ============ STEP 3: APPLY FILTERS & TRIM ============
        console.log('🎬 Applying filters and trimming...')

        try {
          const videoFinalizeService = new VideoFinalizeService()
          finalizeResult = await videoFinalizeService.finalizeVideoProcessing(
            uploadResult.videoUrl,
            filters,
            trimData,
            uploadResult.videoId
          )

          console.log('✅ Video finalized')
          console.log('   Final URL:', finalizeResult.finalUrl.substring(0, 80) + '...')
        } catch (finalizeError: any) {
          console.error('❌ Finalization error:', finalizeError.message)
          throw new Error(`Processing failed: ${finalizeError.message}`)
        }
      }

      // ============ STEP 4: SAVE TO DATABASE ============
      console.log('💾 Saving to database...')

      console.log('upload result',uploadResult)

      const finalUrl = finalizeResult?.finalUrl || uploadResult.videoUrl
      const videoId = finalizeResult?.videoId || uploadResult.videoId
      const extension = finalUrl.split('.').pop() || 'mp4'
      const status = finalizeResult ? 'uploaded' : 'ready'
      const trimmedDuration = finalizeResult
        ? finalizeResult.duration
        : uploadResult.duration

      const video = await Video.create({
        userId: 1,  // ← TODO: Get from auth
        title: uploadResult.fileName,
        originalFilename: `${uploadResult.fileName}`,
        storagePath: videoId,
        fileSize: finalizeResult?.uploaded?.bytes || 0,
        mimeType: `video/${extension}`,
        status:'uploaded',  // ✅ Use 'ready' or 'uploaded'
        extension,
        uploadTime: DateTime.now(),
        uploadDuration: finalizeResult?.uploaded?.duration || uploadResult.duration,
        cloudinaryPublicId: videoId,
        cloudinaryUrl: finalUrl,
        cloudinaryStreamingUrl:
          finalizeResult?.uploaded?.playback_url || uploadResult.videoUrl,
        type: 'video',
        video_thumbnails:uploadResult
      })

      console.log('✅ Saved to database with ID:', video.id)

      // ============ RETURN RESPONSE ============
      const responseData = {
        // upload: {
        //   videoId: uploadResult.videoId,
        //   videoUrl: uploadResult.videoUrl,
        //   duration: uploadResult.duration,
        //   sprites: uploadResult.thumbnailCount,
        // },
        upload : uploadResult
      }

      if (finalizeResult) {
        responseData.finalized = {
          videoId: finalizeResult.videoId,
          finalUrl: finalizeResult.finalUrl,
          duration: finalizeResult.duration,
          processingTime: finalizeResult.processingTime,
        }
      }

      responseData.database = {
        id: video.id,
        title: video.title,
        status: video.status,
      }

      return response.json({
        success: true,
        message: finalizeResult
          ? 'Video uploaded, processed, and saved'
          : 'Video uploaded and saved',
        data: responseData,
      })
    } catch (error: any) {
      console.error('❌ Error:', error.message)

      return response.status(500).json({
        success: false,
        message: error.message || 'Video processing failed',
      })
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

  /**
   * Finalize video with filters and trimming
   * POST /api/v1/videos/finalize
   */
  // async finalizeVideo({ request, response }: HttpContext) {
  //   try {
  //     console.log('📨 Received finalize request')

  //     // Get request data
  //     const videoUrl = request.input('videoUrl')
  //     const duration = request.input('duration')
  //     const filtersStr = request.input('filters')
  //     const trimDataStr = request.input('trimData')

  //     console.log('Received inputs:', {
  //       videoUrl: videoUrl?.substring(0, 50) + '...',
  //       duration,
  //       filtersStr: filtersStr?.substring(0, 50) + '...',
  //       trimDataStr,
  //     })

  //     // ✅ Validate required fields
  //     if (!videoUrl || !filtersStr || !trimDataStr) {
  //       return response.status(400).json({
  //         success: false,
  //         message: 'Missing required fields: videoUrl, filters, trimData',
  //       })
  //     }

  //     // ✅ Parse JSON strings
  //     let filters, trimData
  //     try {
  //       filters = JSON.parse(filtersStr)
  //       trimData = JSON.parse(trimDataStr)
  //       console.log('✅ Parsed filters and trimData')
  //     } catch (parseError) {
  //       return response.status(400).json({
  //         success: false,
  //         message: 'Invalid JSON in filters or trimData',
  //       })
  //     }

  //     console.log('✅ Request validation passed')

  //     // ✅ FIX: Create service instance before calling method
  //     const videoFinalizeService = new VideoFinalizeService()
  //     console.log('✅ Service instance created')

  //     // ✅ FIX: Call method on instance
  //     console.log('🎬 Calling finalizeVideoProcessing...')
  //     const result = await videoFinalizeService.finalizeVideoProcessing(
  //       videoUrl,
  //       filters,
  //       trimData
  //     )

  //     console.log('✅ Finalization successful')
  //     console.log('Result:', {
  //       videoId: result.videoId,
  //       duration: result.duration,
  //       processingStatus: result.processingStatus,
  //     })
      
  //     const extension = result.finalUrl.split('.').pop();
  //     const lastPart = result.videoId.split('/').pop();
  //     const originalName = `${lastPart}.${extension}`

  //     const video = await Video.create({
  //       userId: 1,
  //       title: lastPart,
  //       originalFilename: originalName || 'unknown',
  //       storagePath: result.uploaded.public_id, // ✅ FIXED
  //       fileSize: result.uploaded.bytes,
  //       mimeType: `video/${result.uploaded.format}`,
  //       status: 'uploaded',
  //       extension: result.uploaded.format,
  //       uploadTime: DateTime.now(),
  //       uploadDuration: result.uploaded.duration,
  //       cloudinaryPublicId: result.uploaded.public_id,
  //       cloudinaryUrl: result.uploaded.secure_url,
  //       cloudinaryStreamingUrl:result.uploaded.playback_url,
  //       type:'video'
  //     })

  //     return response.json({
  //       success: true,
  //       message: 'Video processed successfully',
  //       data: result,
  //     })
  //   } catch (error: any) {
  //     console.error('❌ Finalization error:', error.message)
  //     console.error('❌ Error type:', error.constructor.name)
  //     console.error('❌ Stack:', error.stack?.substring(0, 500))

  //     return response.status(500).json({
  //       success: false,
  //       message: error.message || 'Video processing failed',
  //     })
  //   }
  // }

  /**
   * Get video processing status
   * GET /api/v1/videos/:videoId/status
   */
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