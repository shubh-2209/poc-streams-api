import type { HttpContext } from '@adonisjs/core/http'
import { createReadStream, existsSync } from 'node:fs'
import { mkdir } from 'node:fs/promises'
import app from '@adonisjs/core/services/app'
import Video from '#models/video'
import { AudioService } from '#services/audio_service'
import https from 'node:https'
import http from 'node:http'
import fs from 'node:fs'
import path from 'node:path'
 
export default class AudioController {
 
  async download({ params, response }: HttpContext) {
    const video = await Video.findOrFail(params.id)
 
    if (!video.audioPath) {
      return response.notFound({ error: 'Audio not yet extracted. Use /process first.' })
    }
 
    const absolutePath = app.makePath('storage', video.audioPath)
   
    if (!existsSync(absolutePath)) {
      return response.notFound({ error: 'Audio file missing from disk' })
    }
 
    response.header('Content-Type', 'audio/mpeg')
    response.header('Content-Disposition', `attachment; filename="${video.title}_audio.mp3"`)
    return response.stream(createReadStream(absolutePath))
  }
 
  async downloadClean({ params, response }: HttpContext) {
    const video = await Video.findOrFail(params.id)
 
    if (!video.cleanAudioPath) {
      return response.notFound({ error: 'Clean audio not yet processed. Use /process first.' })
    }
 
    const absolutePath = app.makePath('storage', video.cleanAudioPath)
 
    if (!existsSync(absolutePath)) {
      return response.notFound({ error: 'Clean audio file missing from disk' })
    }
 
    response.header('Content-Type', 'audio/mpeg')
    response.header('Content-Disposition', `attachment; filename="${video.title}_clean_audio.mp3"`)
    return response.stream(createReadStream(absolutePath))
  }
 
  async processAudio({ params, response }: HttpContext) {
    const video = await Video.findOrFail(params.id)
    const audioService = new AudioService()
 
    // ✅ FIX: storagePath null ho sakta hai (live stream videos)
    // Us case mein Cloudinary URL se video download karo
    let videoAbsPath: string | null = null
    let tempDownloaded = false
    const tmpDir = app.makePath('storage/videos/tmp')
 
    try {
      await mkdir(tmpDir, { recursive: true })
 
      if (video.storagePath && existsSync(app.makePath('storage', video.storagePath))) {
        videoAbsPath = app.makePath('storage', video.storagePath)
 
      } else if (video.cloudinaryUrl) {
        console.log(`⬇️ Downloading from Cloudinary for audio processing: ${video.cloudinaryUrl}`)
        const tmpVideoPath = path.join(tmpDir, `audio_src_${video.id}.mp4`)
        await this.downloadFile(video.cloudinaryUrl, tmpVideoPath)
        videoAbsPath = tmpVideoPath
        tempDownloaded = true
 
      } else {
        return response.notFound({ error: 'No video source found (no local file, no Cloudinary URL)' })
      }
 
      const audioDir = app.makePath('storage/audio')
      await mkdir(audioDir, { recursive: true })
 
      const audioRelPath = `audio/${video.id}_audio.mp3`
      const audioAbsPath = app.makePath('storage', audioRelPath)
      await audioService.extractAudio(videoAbsPath, audioAbsPath)
 
      const cleanRelPath = `audio/${video.id}_clean.mp3`
      const cleanAbsPath = app.makePath('storage', cleanRelPath)
      await audioService.removeNoise(audioAbsPath, cleanAbsPath)
 
      await video.merge({
        audioPath:      audioRelPath,
        cleanAudioPath: cleanRelPath,
        status:         'ready',
      }).save()
 
      return response.ok({
        message:       'Audio processing complete',
        audioUrl:      `/api/videos/${video.id}/audio`,
        cleanAudioUrl: `/api/videos/${video.id}/audio/clean`,
      })
 
    } catch (error) {
      console.error('Audio processing error:', error)
      await video.merge({ status: 'failed', errorMessage: error.message }).save()
      return response.internalServerError({
        error:   'Audio processing failed',
        details: error.message,
        hint:    'Make sure FFmpeg is installed: ffmpeg -version',
      })
 
    } finally {
      if (tempDownloaded && videoAbsPath && existsSync(videoAbsPath)) {
        fs.unlink(videoAbsPath, () => {})
      }
    }
  }
 
  private downloadFile(url: string, destPath: string): Promise<void> {
    return new Promise((resolve, reject) => {
      const client = url.startsWith('https') ? https : http
      client.get(url, (res) => {
        if (res.statusCode === 301 || res.statusCode === 302) {
          res.resume()
          return this.downloadFile(res.headers.location!, destPath)
            .then(resolve).catch(reject)
        }
        if (res.statusCode !== 200) {
          res.resume()
          return reject(new Error(`Download failed: HTTP ${res.statusCode}`))
        }
        const writer = fs.createWriteStream(destPath)
        res.pipe(writer)
        writer.on('finish', resolve)
        writer.on('error', reject)
      }).on('error', reject)
    })
  }
}
 