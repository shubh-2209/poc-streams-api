import { HttpContext } from '@adonisjs/core/http'
import VideoFinalizeService from '#services/video_finalize_service'
import Video from '#models/video'
import { DateTime } from 'luxon'

export default class VideoFinalizeController {
  /**
   * Finalize video with filters and trimming
   * POST /api/v1/videos/finalize
   */
  async finalizeVideo({ request, response }: HttpContext) {
    try {
      console.log('📨 Received finalize request')

      // Get request data
      const videoUrl = request.input('videoUrl')
      const duration = request.input('duration')
      const filtersStr = request.input('filters')
      const trimDataStr = request.input('trimData')

      console.log('Received inputs:', {
        videoUrl: videoUrl?.substring(0, 50) + '...',
        duration,
        filtersStr: filtersStr?.substring(0, 50) + '...',
        trimDataStr,
      })

      // ✅ Validate required fields
      if (!videoUrl || !filtersStr || !trimDataStr) {
        return response.status(400).json({
          success: false,
          message: 'Missing required fields: videoUrl, filters, trimData',
        })
      }

      // ✅ Parse JSON strings
      let filters, trimData
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

      console.log('✅ Request validation passed')

      // ✅ FIX: Create service instance before calling method
      const videoFinalizeService = new VideoFinalizeService()
      console.log('✅ Service instance created')

      // ✅ FIX: Call method on instance
      console.log('🎬 Calling finalizeVideoProcessing...')
      const result = await videoFinalizeService.finalizeVideoProcessing(
        videoUrl,
        filters,
        trimData
      )

      console.log('✅ Finalization successful')
      console.log('Result:', {
        videoId: result.videoId,
        duration: result.duration,
        processingStatus: result.processingStatus,
      })
      
      const extension = result.finalUrl.split('.').pop();
      const lastPart = result.videoId.split('/').pop();
      const originalName = `${lastPart}.${extension}`

      const video = await Video.create({
        userId: 1,
        title: lastPart,
        originalFilename: originalName || 'unknown',
        storagePath: result.uploaded.public_id, // ✅ FIXED
        fileSize: result.uploaded.bytes,
        mimeType: `video/${result.uploaded.format}`,
        status: 'uploaded',
        extension: result.uploaded.format,
        uploadTime: DateTime.now(),
        uploadDuration: result.uploaded.duration,
        cloudinaryPublicId: result.uploaded.public_id,
        cloudinaryUrl: result.uploaded.secure_url,
        cloudinaryStreamingUrl:result.uploaded.playback_url,
        type:'video'
      })

      return response.json({
        success: true,
        message: 'Video processed successfully',
        data: result,
      })
    } catch (error: any) {
      console.error('❌ Finalization error:', error.message)
      console.error('❌ Error type:', error.constructor.name)
      console.error('❌ Stack:', error.stack?.substring(0, 500))

      return response.status(500).json({
        success: false,
        message: error.message || 'Video processing failed',
      })
    }
  }

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