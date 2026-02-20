// app/services/live_stream_service.ts
import fs from 'fs/promises'
import path from 'path'
import { execSync, exec } from 'child_process'
import { promisify } from 'util'
import { v2 as cloudinary } from 'cloudinary'
import Video from '#models/video'
import { DateTime } from 'luxon'

const execAsync = promisify(exec)

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
  cloudinaryStreamingUrl?: string  
  cloudinaryPublicId?: string      
  error?: string
}

interface CloudinaryResult {
  success: boolean
  cloudinaryUrl?: string
  cloudinaryStreamingUrl?: string
  cloudinaryPublicId?: string
  duration?: number
  width?: number
  height?: number
}

export default class LiveStreamService {
  private static activeSessions: Map<string, StreamSession> = new Map()

  static configure() {
    cloudinary.config({
      cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
      api_key: process.env.CLOUDINARY_API_KEY,
      api_secret: process.env.CLOUDINARY_API_SECRET,
    })
  }

  constructor() {
    LiveStreamService.configure()
  }

  createSession(userId: number, title: string): string {
    const sessionId = this.generateSessionId()
    const session: StreamSession = {
      userId,
      sessionId,
      recordedChunks: [],
      startTime: new Date(),
      title,
    }

    LiveStreamService.activeSessions.set(sessionId, session)
    console.log('\x1b[32m✅ Session CREATED:\x1b[0m', sessionId)
    return sessionId
  }

  addChunk(sessionId: string, chunk: Blob): boolean {
    const session = LiveStreamService.activeSessions.get(sessionId)

    if (!session) {
      console.log('\x1b[31m❌ addChunk: Session NOT FOUND:\x1b[0m', sessionId)
      return false
    }

    session.recordedChunks.push(chunk)
    console.log(`\x1b[33m📦 Chunk ADDED:\x1b[0m ${sessionId} | Total: ${session.recordedChunks.length}`)
    return true
  }

  getSession(sessionId: string): StreamSession | undefined {
    return LiveStreamService.activeSessions.get(sessionId)
  }

  async endStream(sessionId: string): Promise<UploadResult> {
    const session = LiveStreamService.activeSessions.get(sessionId)

    if (!session) {
      console.log('\x1b[31m❌ endStream: Session NOT FOUND:\x1b[0m', sessionId)
      return { success: false, error: 'Session not found' }
    }

    const tmpDir = path.join(process.cwd(), 'tmp')
    const webmPath = path.join(tmpDir, `stream_${sessionId}.webm`)
    const mp4Path = path.join(tmpDir, `stream_${sessionId}.mp4`)

    try {
      console.log(`\x1b[34m🎬 Processing stream:\x1b[0m ${sessionId} | Chunks: ${session.recordedChunks.length}`)

      if (session.recordedChunks.length === 0) {
        LiveStreamService.activeSessions.delete(sessionId)
        return { success: false, error: 'No video data recorded' }
      }

      const blob = new Blob(session.recordedChunks, { type: 'video/webm' })
      const buffer = Buffer.from(await blob.arrayBuffer())

      if (buffer.length === 0) {
        LiveStreamService.activeSessions.delete(sessionId)
        return { success: false, error: 'Empty video data' }
      }

      await fs.mkdir(tmpDir, { recursive: true })
      await fs.writeFile(webmPath, buffer)
      console.log(`\x1b[34m💾 WebM saved:\x1b[0m ${this.formatBytes(buffer.length)}`)

      const ffmpegAvailable = await this.checkFfmpeg()
      let uploadPath = webmPath

      if (ffmpegAvailable) {
        console.log('\x1b[36m🔄 Converting WebM → MP4 with FFmpeg...\x1b[0m')
        try {
          await execAsync(
            `ffmpeg -y -i "${webmPath}" -c:v libx264 -preset fast -crf 23 -c:a aac -movflags +faststart "${mp4Path}"`
          )
          uploadPath = mp4Path
          console.log('\x1b[32m✅ FFmpeg conversion successful!\x1b[0m')
        } catch (ffmpegErr) {
          console.error('\x1b[33m⚠️ FFmpeg failed, uploading raw WebM:\x1b[0m', ffmpegErr)
          uploadPath = webmPath
        }
      } else {
        console.log('\x1b[33m⚠️ FFmpeg not found, uploading raw WebM\x1b[0m')
      }

      console.log('\x1b[36m☁️ Uploading to Cloudinary...\x1b[0m')
      const cloudinaryResult = await this.uploadToCloudinary(uploadPath, session.userId, session.title)

      await fs.unlink(webmPath).catch(() => {})
      await fs.unlink(mp4Path).catch(() => {})

      if (!cloudinaryResult.success) {
        LiveStreamService.activeSessions.delete(sessionId)
        return { success: false, error: 'Cloudinary upload failed' }
      }

      console.log('\x1b[36m💾 Saving to database...\x1b[0m')
      console.log('Cloudinary result:', cloudinaryResult)

      const videoRecord = await Video.create({
        userId:    session.userId,
        title:     session.title,
        originalFilename: `stream_${sessionId}.mp4`,

        storagePath: null,

        extension: 'mp4',
        mimeType:  'video/mp4',
        fileSize:  buffer.length,
        status:    'uploaded',
        uploadTime: DateTime.now(),

        cloudinaryUrl:          cloudinaryResult.cloudinaryUrl ?? null,
        cloudinaryStreamingUrl: cloudinaryResult.cloudinaryStreamingUrl ?? null,
        cloudinaryPublicId:     cloudinaryResult.cloudinaryPublicId ?? null,

        duration:   cloudinaryResult.duration   ? Math.round(cloudinaryResult.duration) : null,
        resolution: cloudinaryResult.width && cloudinaryResult.height
          ? `${cloudinaryResult.width}x${cloudinaryResult.height}`
          : null,
        type:"video"
      })

      console.log('\x1b[32m✅ Video saved! ID:\x1b[0m', videoRecord.id)
      console.log('\x1b[32m✅ cloudinaryUrl:\x1b[0m', videoRecord.cloudinaryUrl)
      console.log('\x1b[32m✅ cloudinaryStreamingUrl:\x1b[0m', videoRecord.cloudinaryStreamingUrl)
      console.log('\x1b[32m✅ cloudinaryPublicId:\x1b[0m', videoRecord.cloudinaryPublicId)

      LiveStreamService.activeSessions.delete(sessionId)

      return {
        success: true,
        videoId: videoRecord.id,
        cloudinaryUrl:          videoRecord.cloudinaryUrl ?? undefined,
        cloudinaryStreamingUrl: videoRecord.cloudinaryStreamingUrl ?? undefined,
        cloudinaryPublicId:     videoRecord.cloudinaryPublicId ?? undefined,
      }

    } catch (error) {
      console.error('\x1b[31m❌ endStream ERROR:\x1b[0m', error)
      await fs.unlink(webmPath).catch(() => {})
      await fs.unlink(mp4Path).catch(() => {})
      LiveStreamService.activeSessions.delete(sessionId)
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      }
    }
  }

  private async checkFfmpeg(): Promise<boolean> {
    try {
      execSync('ffmpeg -version', { stdio: 'ignore' })
      return true
    } catch {
      return false
    }
  }

  private async uploadToCloudinary(
    filePath: string,
    userId: number,
    title: string
  ): Promise<CloudinaryResult> {
    try {
      if (
        !process.env.CLOUDINARY_CLOUD_NAME ||
        !process.env.CLOUDINARY_API_KEY ||
        !process.env.CLOUDINARY_API_SECRET
      ) {
        throw new Error('Cloudinary environment variables not configured')
      }

      const isWebm = filePath.endsWith('.webm')
      const publicId = `stream_${Date.now()}`

      const result = await cloudinary.uploader.upload(filePath, {
        resource_type: 'video',
        folder:        `live_streams/user_${userId}`,
        public_id:     publicId,
        display_name:  title,
        tags:          ['live_stream', `user_${userId}`],
        ...(isWebm && {
          eager:       [{ format: 'mp4', video_codec: 'h264' }],
          eager_async: false,
        }),
      })

      console.log('\x1b[32m✅ Cloudinary raw result:\x1b[0m', {
        secure_url: result.secure_url,
        public_id:  result.public_id,
        duration:   result.duration,
        width:      result.width,
        height:     result.height,
      })

      let finalUrl = result.secure_url
      if (isWebm && result.eager && result.eager[0]?.secure_url) {
        finalUrl = result.eager[0].secure_url
      }

      const streamingUrl = finalUrl
        .replace('/upload/', '/upload/sp_auto/')
        .replace(/\.(mp4|mov|avi|mkv|webm|flv|wmv)$/i, '.m3u8')

      console.log('\x1b[32m✅ Cloudinary URL:\x1b[0m', finalUrl)
      console.log('\x1b[32m✅ Streaming URL:\x1b[0m', streamingUrl)
      console.log('\x1b[32m✅ Public ID:\x1b[0m', result.public_id)

      return {
        success:               true,
        cloudinaryUrl:         finalUrl,
        cloudinaryStreamingUrl: streamingUrl,
        cloudinaryPublicId:    result.public_id,   
        duration:              result.duration,
        width:                 result.width,
        height:                result.height,
      }

    } catch (error) {
      console.error('\x1b[31m❌ Cloudinary ERROR:\x1b[0m', error instanceof Error ? error.message : error)
      return { success: false }
    }
  }

  cancelSession(sessionId: string): boolean {
    if (!LiveStreamService.activeSessions.has(sessionId)) return false
    LiveStreamService.activeSessions.delete(sessionId)
    console.log('\x1b[33m🗑️ Session CANCELLED:\x1b[0m', sessionId)
    return true
  }

  getActiveSessionsCount(): number {
    return LiveStreamService.activeSessions.size
  }

  getActiveSessions(): Map<string, StreamSession> {
    return LiveStreamService.activeSessions
  }

  private generateSessionId(): string {
    return `stream_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`
  }

  private formatBytes(bytes: number): string {
    if (bytes === 0) return '0 Bytes'
    const k = 1024
    const sizes = ['Bytes', 'KB', 'MB', 'GB']
    const i = Math.floor(Math.log(bytes) / Math.log(k))
    return Math.round((bytes / Math.pow(k, i)) * 100) / 100 + ' ' + sizes[i]
  }
}