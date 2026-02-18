// app/controllers/live_streams_controller.ts
import { HttpContext } from '@adonisjs/core/http'
import { inject } from '@adonisjs/core'
import { readFile } from 'node:fs/promises'
import LiveStreamService from '#services/live_stream_service'

@inject()
export default class LiveStreamsController {
  constructor(private liveStreamService: LiveStreamService) {}

  /**
   * Start a new live stream
   * POST /api/live-streams/start
   */
  async start({ request, response }: HttpContext) {
    try {
      // ✅ For testing: use userId = 1 (must exist in database!)
      // Replace with: const user = await auth.authenticate() in production
      const userId = 1

      const { title } = request.only(['title'])

      if (!title || title.trim().length === 0) {
        return response.badRequest({
          success: false,
          message: 'Title is required',
        })
      }

      const sessionId = this.liveStreamService.createSession(userId, title)

      console.log('\x1b[32m✅ Session CREATED:\x1b[0m', sessionId)
      console.log('Active sessions count:', this.liveStreamService.getActiveSessionsCount())

      return response.ok({
        success: true,
        sessionId,
        message: 'Live stream session created',
      })
    } catch (error) {
      console.error('\x1b[31m❌ Error in start:\x1b[0m', error)
      return response.internalServerError({
        success: false,
        message: 'Error starting stream',
        error: error instanceof Error ? error.message : 'Unknown error',
      })
    }
  }

  /**
   * Receive video chunks during live streaming
   * POST /api/live-streams/:sessionId/chunk
   */
  async receiveChunk({ params, request, response }: HttpContext) {
    try {
      const { sessionId } = params
      const chunk = request.file('chunk')

      if (!chunk) {
        return response.badRequest({
          success: false,
          message: 'Chunk is required',
        })
      }

      // ✅ Check if file is valid
      if (!chunk.isValid) {
        return response.badRequest({
          success: false,
          message: 'Invalid file upload',
          errors: chunk.errors,
        })
      }

      // ✅ Read file from temp path
      const buffer = await readFile(chunk.tmpPath!)
      const blob = new Blob([buffer], {
        type: chunk.type ? `${chunk.type}/${chunk.subtype}` : 'video/webm',
      })

      // ✅ Add chunk to service
      const added = this.liveStreamService.addChunk(sessionId, blob)

      if (!added) {
        console.log('\x1b[31m❌ Session NOT FOUND:\x1b[0m', sessionId)
        return response.notFound({
          success: false,
          message: 'Session not found',
        })
      }

      console.log('\x1b[33m✅ Chunk ADDED:\x1b[0m', sessionId)

      return response.ok({
        success: true,
        message: 'Chunk received',
      })
    } catch (error) {
      console.error('\x1b[31m❌ Error in receiveChunk:\x1b[0m', error)
      return response.internalServerError({
        success: false,
        message: 'Error receiving chunk',
        error: error instanceof Error ? error.message : 'Unknown error',
      })
    }
  }

  /**
   * End live stream and save to database
   * POST /api/live-streams/:sessionId/end
   */
  async end({ params, response }: HttpContext) {
    try {
      const { sessionId } = params

      console.log('\x1b[34m🔚 END called for session:\x1b[0m', sessionId)

      const result = await this.liveStreamService.endStream(sessionId)

      if (!result.success) {
        console.log('\x1b[31m❌ END failed:\x1b[0m', result.error)
        return response.internalServerError({
          success: false,
          message: result.error || 'Failed to end stream',
        })
      }

      console.log('\x1b[32m✅ Video SAVED! ID:\x1b[0m', result.videoId)
      console.log('\x1b[32m✅ Cloudinary URL:\x1b[0m', result.cloudinaryUrl)

      return response.ok({
        success: true,
        videoId: result.videoId,
        cloudinaryUrl: result.cloudinaryUrl,
        message: 'Live stream saved successfully',
      })
    } catch (error) {
      console.error('\x1b[31m❌ Error in end:\x1b[0m', error)
      return response.internalServerError({
        success: false,
        message: 'Error ending stream',
        error: error instanceof Error ? error.message : 'Unknown error',
      })
    }
  }

  /**
   * Cancel live stream (cleanup)
   * POST /api/live-streams/:sessionId/cancel
   */
  async cancel({ params, response }: HttpContext) {
    try {
      const { sessionId } = params

      const cancelled = this.liveStreamService.cancelSession(sessionId)

      if (!cancelled) {
        console.log('\x1b[31m❌ CANCEL: Session not found:\x1b[0m', sessionId)
        return response.notFound({
          success: false,
          message: 'Session not found',
        })
      }

      console.log('\x1b[33m🗑️ Session CANCELLED:\x1b[0m', sessionId)

      return response.ok({
        success: true,
        message: 'Stream cancelled',
      })
    } catch (error) {
      console.error('\x1b[31m❌ Error in cancel:\x1b[0m', error)
      return response.internalServerError({
        success: false,
        message: 'Error cancelling stream',
        error: error instanceof Error ? error.message : 'Unknown error',
      })
    }
  }

  /**
   * Get active sessions (for debugging)
   * GET /api/live-streams/debug/sessions
   */
  async debugSessions({ response }: HttpContext) {
    const sessions = this.liveStreamService.getActiveSessions()
    const count = this.liveStreamService.getActiveSessionsCount()

    return response.ok({
      success: true,
      activeSessionsCount: count,
      sessionIds: Array.from(sessions.keys()),
      sessions: Array.from(sessions.values()).map((s) => ({
        sessionId: s.sessionId,
        title: s.title,
        userId: s.userId,
        chunksCount: s.recordedChunks.length,
        startTime: s.startTime,
      })),
    })
  }
}