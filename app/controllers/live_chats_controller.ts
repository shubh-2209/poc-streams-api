import type { HttpContext } from '@adonisjs/core/http'
import LiveChat from '#models/live_chat'

export default class LiveChatsController {
  // Get chat by session
  async getBySession({ params, response }: HttpContext) {
    const chats = await LiveChat.query()
      .where('session_id', params.sessionId)
      .orderBy('created_at', 'asc')

    return response.ok({ chats })
  }

  // Get chat by video (after stream ends)
  async getByVideo({ params, response }: HttpContext) {
    const chats = await LiveChat.query()
      .where('video_id', params.videoId)
      .orderBy('created_at', 'asc')

    return response.ok({ chats })
  }
}
