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
   * SSE (Server-Sent Events) version — real-time progress to frontend
   * 
   * IMPORTANT: This streams progress events so frontend shows real status
   */
  async finalizeVideo({ request, response }: HttpContext) {
    // ── SSE Headers ───────────────────────────────────────────────
    response.response.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
      'Access-Control-Allow-Origin': '*',
      'X-Accel-Buffering': 'no', // Nginx buffering disable (important!)
    })

    // Helper: send SSE event
    const send = (event: string, data: object) => {
      response.response.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`)
    }

    try {
      console.log('📨 Received finalize request (SSE mode)')

      // ── Get Video File ────────────────────────────────────────
      const videoFile = request.file('video')

      if (!videoFile) {
        send('error', { message: 'No video file provided' })
        response.response.end()
        return
      }

      console.log('📤 Video file received:', videoFile.clientName, videoFile.size, 'bytes')

      // ── STEP 1: Upload + Sprite Generation (~30-60s for large files) ──
      send('progress', { 
        step: 'upload', 
        percent: 5, 
        message: 'Uploading video to cloud storage...' 
      })

      const videoThumbnailService = new VideoThumbnailService()
      const uploadResult = await videoThumbnailService.processVideoUpload(videoFile)

      console.log('✅ Original video uploaded, ID:', uploadResult.videoId)

      send('progress', { 
        step: 'upload', 
        percent: 40, 
        message: 'Video uploaded! Preparing to process filters...' 
      })

      // ── STEP 2: Get Filters & Trim ────────────────────────────
      const filtersStr = request.input('filters')
      const trimDataStr = request.input('trimData')

      let filters = null
      let trimData = null
      let finalizeResult = null

      if (filtersStr && trimDataStr) {
        try {
          filters = JSON.parse(filtersStr)
          trimData = JSON.parse(trimDataStr)
        } catch (parseError) {
          send('error', { message: 'Invalid JSON in filters or trimData' })
          response.response.end()
          return
        }

        // Check if any non-default filters were actually applied
        const hasCustomFilters = (
          filters.brightness !== 100 ||
          filters.contrast !== 100 ||
          filters.saturation !== 100 ||
          filters.hue !== 0 ||
          filters.blur > 0 ||
          filters.sharpen !== 0 ||
          filters.opacity !== 100
        )

        // Check if trim is actually different from full video
        const hasTrim = trimData.start > 0 || 
          (trimData.end !== null && Math.abs(trimData.end - uploadResult.duration) > 1)

        if (!hasCustomFilters && !hasTrim) {
          // No processing needed — skip FFmpeg entirely!
          console.log('⚡ No filters/trim needed, skipping FFmpeg processing')
          send('progress', { 
            step: 'skip', 
            percent: 90, 
            message: 'No filters applied, skipping processing...' 
          })
        } else {
          // ── STEP 3: Apply Filters & Trim (FFmpeg) ──────────────
          send('progress', { 
            step: 'processing', 
            percent: 50, 
            message: 'Applying filters and trimming (this may take 1-3 minutes)...' 
          })

          console.log('🎬 Applying filters and trimming...')

          try {
            const videoFinalizeService = new VideoFinalizeService()

            // Inject progress callback into service
            finalizeResult = await videoFinalizeService.finalizeVideoProcessing(
              uploadResult.videoUrl,
              filters,
              trimData,
              uploadResult.videoId,
              // Progress callback
              (ffmpegPercent: number) => {
                // FFmpeg goes 0→100 during processing
                // Map it to 50→85 in our overall progress
                const mapped = 50 + Math.floor(ffmpegPercent * 0.35)
                send('progress', { 
                  step: 'processing', 
                  percent: mapped, 
                  message: `Processing video: ${Math.round(ffmpegPercent)}%` 
                })
              }
            )

            console.log('✅ Video finalized')
            send('progress', { 
              step: 'uploading_result', 
              percent: 88, 
              message: 'Uploading processed video...' 
            })
          } catch (finalizeError: any) {
            console.error('❌ Finalization error:', finalizeError.message)
            send('error', { message: `Processing failed: ${finalizeError.message}` })
            response.response.end()
            return
          }
        }
      }

      // ── STEP 4: Save to Database ─────────────────────────────
      send('progress', { 
        step: 'saving', 
        percent: 93, 
        message: 'Saving to database...' 
      })

      const finalUrl = finalizeResult?.finalUrl || uploadResult.videoUrl
      const videoId = finalizeResult?.videoId || uploadResult.videoId
      const extension = finalUrl.split('.').pop() || 'mp4'

      const video = await Video.create({
        userId: 1, // ← TODO: Get from auth
        title: uploadResult.fileName,
        originalFilename: uploadResult.fileName,
        storagePath: videoId,
        fileSize: finalizeResult?.uploaded?.bytes || 0,
        mimeType: `video/${extension}`,
        status: 'uploaded',
        extension,
        uploadTime: DateTime.now(),
        uploadDuration: finalizeResult?.uploaded?.duration || uploadResult.duration,
        cloudinaryPublicId: videoId,
        cloudinaryUrl: finalUrl,
        cloudinaryStreamingUrl: finalizeResult?.uploaded?.playback_url || uploadResult.videoUrl,
        type: 'video',
        video_thumbnails: uploadResult,
      })

      console.log('✅ Saved to database with ID:', video.id)

      // ── STEP 5: Send Final Result ─────────────────────────────
      send('progress', { step: 'done', percent: 100, message: 'Complete!' })

      const responseData: any = {
        upload: uploadResult,
        database: {
          id: video.id,
          title: video.title,
          status: video.status,
        },
      }

      if (finalizeResult) {
        responseData.finalized = {
          videoId: finalizeResult.videoId,
          finalUrl: finalizeResult.finalUrl,
          duration: finalizeResult.duration,
          processingTime: finalizeResult.processingTime,
        }
      }

      send('complete', {
        success: true,
        message: finalizeResult
          ? 'Video uploaded, processed, and saved'
          : 'Video uploaded and saved',
        data: responseData,
      })

    } catch (error: any) {
      console.error('❌ Error:', error.message)
      send('error', { message: error.message || 'Video processing failed' })
    } finally {
      response.response.end()
    }
  }

  // ── Other endpoints unchanged ─────────────────────────────────

  async getVideoDetails({ request, response }: HttpContext) {
    try {
      const videoId = request.param('videoId')
      if (!videoId) {
        return response.status(400).json({ success: false, message: 'Video ID required' })
      }
      const video = await Video.find(videoId)
      if (!video) {
        return response.status(404).json({ success: false, message: 'Video not found' })
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
      return response.status(500).json({ success: false, message: error.message })
    }
  }

  async getProcessingStatus({ request, response }: HttpContext) {
    try {
      const videoId = request.param('videoId')
      if (!videoId) {
        return response.status(400).json({ success: false, message: 'videoId is required' })
      }
      return response.json({
        success: true,
        data: { videoId, status: 'completed', progress: 100, message: 'Video processing completed' },
      })
    } catch (error: any) {
      return response.status(500).json({ success: false, message: error.message })
    }
  }

  async cancelProcessing({ request, response }: HttpContext) {
    try {
      const videoId = request.param('videoId')
      if (!videoId) {
        return response.status(400).json({ success: false, message: 'videoId is required' })
      }
      return response.json({
        success: true,
        message: 'Processing cancelled successfully',
        data: { videoId, cancelledAt: new Date().toISOString() },
      })
    } catch (error: any) {
      return response.status(500).json({ success: false, message: error.message })
    }
  }
}