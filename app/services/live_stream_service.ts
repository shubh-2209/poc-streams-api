// app/services/live_stream_service.ts
import fs from 'fs/promises'
import path from 'path'
import { v2 as cloudinary } from 'cloudinary'
import Video from '#models/video'

interface StreamSession {
  userId: number
  sessionId: string
  recordedChunks: Blob[]
  startTime: Date
  title: string
}

interface UploadResult {
  success: boolean
  videoId?: number
  cloudinaryUrl?: string
  error?: string
}

export default class LiveStreamService {
  // ✅ STATIC MAP - Sabhi instances share karengi
  private static activeSessions: Map<string, StreamSession> = new Map()

  static configure() {
    cloudinary.config({
      cloud_name: process.env.CLOUDINARY_NAME,
      api_key: process.env.CLOUDINARY_API_KEY,
      api_secret: process.env.CLOUDINARY_API_SECRET,
    })
  }

  constructor() {
    // Constructor mein configure karo
    LiveStreamService.configure()
  }

  /**
   * Create new session
   */
  createSession(userId: number, title: string): string {
    const sessionId = this.generateSessionId()
    const session: StreamSession = {
      userId,
      sessionId,
      recordedChunks: [],
      startTime: new Date(),
      title,
    }

    // ✅ STATIC map use karo
    LiveStreamService.activeSessions.set(sessionId, session)

    console.log('\x1b[32m✅ Session CREATED:\x1b[0m', sessionId)
    console.log('Total active sessions:', LiveStreamService.activeSessions.size)

    return sessionId
  }

  /**
   * Add chunk to session
   */
  addChunk(sessionId: string, chunk: Blob): boolean {
    // ✅ Static map se get karo
    const session = LiveStreamService.activeSessions.get(sessionId)
    
    if (!session) {
      console.log('\x1b[31m❌ addChunk: Session NOT FOUND:\x1b[0m', sessionId)
      console.log('Available sessions:', Array.from(LiveStreamService.activeSessions.keys()))
      return false
    }

    session.recordedChunks.push(chunk)
    console.log('\x1b[33m📦 Chunk ADDED:\x1b[0m', sessionId, '| Total chunks:', session.recordedChunks.length)
    return true
  }

  /**
   * End stream and upload to Cloudinary
   */
  async endStream(sessionId: string): Promise<UploadResult> {
    // ✅ Static map se get karo
    const session = LiveStreamService.activeSessions.get(sessionId)
    
    if (!session) {
      console.log('\x1b[31m❌ endStream: Session NOT FOUND:\x1b[0m', sessionId)
      return { success: false, error: 'Session not found' }
    }

    try {
      console.log('\x1b[34m🎬 Processing stream:\x1b[0m', sessionId, '| Chunks:', session.recordedChunks.length)

      // ✅ Combine chunks
      const blob = new Blob(session.recordedChunks, { type: 'video/webm' })

      if (blob.size === 0) {
        LiveStreamService.activeSessions.delete(sessionId)
        return { success: false, error: 'No video data recorded' }
      }

      console.log('\x1b[34m📦 Video size:\x1b[0m', this.formatBytes(blob.size))

      // ✅ Convert to buffer and save temp file
      const buffer = Buffer.from(await blob.arrayBuffer())
      const tempFilePath = path.join(process.cwd(), 'tmp', `stream_${sessionId}.webm`)

      await fs.mkdir(path.dirname(tempFilePath), { recursive: true })
      await fs.writeFile(tempFilePath, buffer)

      console.log('\x1b[34m💾 Temp file saved:\x1b[0m', tempFilePath)

      // ✅ Upload to Cloudinary
      console.log('\x1b[36m☁️ Uploading to Cloudinary...\x1b[0m')
      const cloudinaryResult = await this.uploadToCloudinary(tempFilePath, session.userId, session.title)

      if (!cloudinaryResult.success) {
        await fs.unlink(tempFilePath).catch(() => {})
        LiveStreamService.activeSessions.delete(sessionId)
        return { success: false, error: 'Cloudinary upload failed' }
      }

      console.log('\x1b[32m✅ Cloudinary upload successful!\x1b[0m')

      // ✅ Save to database
      console.log('\x1b[36m💾 Saving to database...\x1b[0m')
      const videoRecord = await Video.create({
        userId: session.userId,
        title: session.title,
        originalFilename: `stream_${sessionId}.webm`,
        storagePath: cloudinaryResult.cloudinaryUrl!,
        extension: 'webm',
        mimeType: 'video/webm',
        fileSize: blob.size,
        status: 'ready',
      })

      console.log('\x1b[32m✅ Video saved to database! Video ID:\x1b[0m', videoRecord.id)

      // ✅ Cleanup
      await fs.unlink(tempFilePath).catch(() => {})
      LiveStreamService.activeSessions.delete(sessionId)

      return {
        success: true,
        videoId: videoRecord.id,
        cloudinaryUrl: cloudinaryResult.cloudinaryUrl,
      }
    } catch (error) {
      console.error('\x1b[31m❌ endStream ERROR:\x1b[0m', error)
      LiveStreamService.activeSessions.delete(sessionId)
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      }
    }
  }

  /**
   * Upload to Cloudinary
   */
  private async uploadToCloudinary(
    filePath: string,
    userId: number,
    title: string
  ): Promise<{ success: boolean; cloudinaryUrl?: string }> {
    try {
      // ✅ Verify Cloudinary config
      if (!process.env.CLOUDINARY_NAME) {
        throw new Error('CLOUDINARY_NAME not configured in .env')
      }
      if (!process.env.CLOUDINARY_API_KEY) {
        throw new Error('CLOUDINARY_API_KEY not configured in .env')
      }
      if (!process.env.CLOUDINARY_API_SECRET) {
        throw new Error('CLOUDINARY_API_SECRET not configured in .env')
      }

      const result = await cloudinary.uploader.upload(filePath, {
        resource_type: 'video',
        folder: `live_streams/user_${userId}`,
        public_id: `stream_${Date.now()}`,
        display_name: title,
        tags: ['live_stream', `user_${userId}`],
      })

      console.log('\x1b[32m✅ Cloudinary URL:\x1b[0m', result.secure_url)
      return {
        success: true,
        cloudinaryUrl: result.secure_url,
      }
    } catch (error) {
      console.error('\x1b[31m❌ Cloudinary upload ERROR:\x1b[0m', error instanceof Error ? error.message : error)
      return { success: false }
    }
  }

  /**
   * Cancel session
   */
  cancelSession(sessionId: string): boolean {
    // ✅ Static map check
    if (!LiveStreamService.activeSessions.has(sessionId)) {
      console.log('\x1b[31m❌ cancelSession: Session NOT FOUND:\x1b[0m', sessionId)
      return false
    }

    LiveStreamService.activeSessions.delete(sessionId)
    console.log('\x1b[33m🗑️ Session CANCELLED:\x1b[0m', sessionId)
    return true
  }

  /**
   * Get active sessions count
   */
  getActiveSessionsCount(): number {
    return LiveStreamService.activeSessions.size
  }

  /**
   * Get active sessions (for debugging)
   */
  getActiveSessions(): Map<string, StreamSession> {
    return LiveStreamService.activeSessions
  }

  /**
   * Generate unique session ID
   */
  private generateSessionId(): string {
    return `stream_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`
  }

  /**
   * Format bytes
   */
  private formatBytes(bytes: number): string {
    if (bytes === 0) return '0 Bytes'
    const k = 1024
    const sizes = ['Bytes', 'KB', 'MB', 'GB']
    const i = Math.floor(Math.log(bytes) / Math.log(k))
    return Math.round((bytes / Math.pow(k, i)) * 100) / 100 + ' ' + sizes[i]
  }
}