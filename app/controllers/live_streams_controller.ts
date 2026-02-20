import { HttpContext } from '@adonisjs/core/http'
import { inject } from '@adonisjs/core'
import { readFile } from 'node:fs/promises'
import LiveStreamService from '#services/live_stream_service'

@inject()
export default class LiveStreamsController {
  constructor(private liveStreamService: LiveStreamService) {}

  async start({ request, response, auth }: HttpContext) {
    try {
      // ✅ Hardcoded userId hata diya — real auth se lo
      const user = await auth.use('api').authenticate()

      const { title } = request.only(['title'])

      if (!title || title.trim().length === 0) {
        return response.badRequest({ success: false, message: 'Title is required' })
      }

      const sessionId = this.liveStreamService.createSession(user.id, title, user.fullName ?? user.email)

      return response.ok({
        success: true,
        sessionId,
        broadcaster: {
          id: user.id,
          fullName: user.fullName,
          email: user.email,
        },
        message: 'Live stream session created',
      })
    } catch (error) {
      return response.unauthorized({ success: false, message: 'Authentication required' })
    }
  }

  // receiveChunk, end, cancel, debugSessions — same rakho
  async receiveChunk({ params, request, response }: HttpContext) {
    try {
      const { sessionId } = params
      const chunk = request.file('chunk')
      if (!chunk) return response.badRequest({ success: false, message: 'Chunk is required' })
      if (!chunk.isValid) return response.badRequest({ success: false, message: 'Invalid file upload', errors: chunk.errors })

      const buffer = await readFile(chunk.tmpPath!)
      const blob = new Blob([buffer], { type: chunk.type ? `${chunk.type}/${chunk.subtype}` : 'video/webm' })
      const added = this.liveStreamService.addChunk(sessionId, blob)

      if (!added) return response.notFound({ success: false, message: 'Session not found' })
      return response.ok({ success: true, message: 'Chunk received' })
    } catch (error) {
      return response.internalServerError({ success: false, message: 'Error receiving chunk' })
    }
  }

  async end({ params, response }: HttpContext) {
    try {
      const { sessionId } = params
      const result = await this.liveStreamService.endStream(sessionId)
      if (!result.success) return response.internalServerError({ success: false, message: result.error || 'Failed to end stream' })

      return response.ok({
        success: true,
        videoId: result.videoId,
        cloudinaryUrl: result.cloudinaryUrl,
        message: 'Live stream saved successfully',
      })
    } catch (error) {
      return response.internalServerError({ success: false, message: 'Error ending stream' })
    }
  }

  async cancel({ params, response }: HttpContext) {
    try {
      const { sessionId } = params
      const cancelled = this.liveStreamService.cancelSession(sessionId)
      if (!cancelled) return response.notFound({ success: false, message: 'Session not found' })
      return response.ok({ success: true, message: 'Stream cancelled' })
    } catch (error) {
      return response.internalServerError({ success: false, message: 'Error cancelling stream' })
    }
  }

  async debugSessions({ response }: HttpContext) {
    const sessions = this.liveStreamService.getActiveSessions()
    const count = this.liveStreamService.getActiveSessionsCount()
    return response.ok({
      success: true,
      activeSessionsCount: count,
      sessions: Array.from(sessions.values()).map((s) => ({
        sessionId: s.sessionId,
        title: s.title,
        userId: s.userId,
        broadcasterName: s.broadcasterName,
        chunksCount: s.recordedChunks.length,
      })),
    })
  }
}