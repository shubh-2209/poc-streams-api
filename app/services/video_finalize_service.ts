import fs from 'fs/promises'
import fsSync from 'fs'
import path from 'path'
import https from 'https'
import http from 'http'
import app from '@adonisjs/core/services/app'
import { v2 as cloudinary } from 'cloudinary'
import ffmpeg from 'fluent-ffmpeg'

export default class VideoFinalizeService {

  async finalizeVideoProcessing(
    videoUrl: string,
    filters: any,
    trimData: any,
    videoId?: string
  ): Promise<any> {

    console.log('🎬 Starting video finalization')

    const baseDir = app.tmpPath()
    const uniqueId = Date.now().toString()
    let tempDir: string | null = null

    try {
      tempDir = path.join(baseDir, `finalize-${uniqueId}`)
      await fs.mkdir(tempDir, { recursive: true })

      // verify write permission
      const test = path.join(tempDir, '.test')
      await fs.writeFile(test, 'ok')
      await fs.unlink(test)

      const inputPath = path.join(tempDir, 'input.mp4')
      const outputPath = path.join(tempDir, 'output.mp4')

      console.log('⬇ Downloading video...')
      await this.downloadVideoFromUrl(videoUrl, inputPath)

      console.log('🔧 Processing video...')
      const processingTime = await this.applyFiltersAndTrim(
        inputPath,
        outputPath,
        filters,
        trimData
      )

      console.log('☁ Uploading to cloud...')
      const uploaded = await cloudinary.uploader.upload(outputPath, {
        resource_type: 'video',
        folder: 'streaming/videos/processed',
        public_id: `finalized-${videoId || uniqueId}`,
        quality: 'auto',
        fetch_format: 'auto'
      })

      const finalDuration = trimData.end - trimData.start

      return {
        videoId: uploaded.public_id,
        finalUrl: uploaded.secure_url,
        processingStatus: 'completed',
        duration: finalDuration,
        appliedFilters: filters,
        processingTime
      }

    } catch (error: any) {
      console.error('❌ Finalization failed:', error.message)
      throw error
    }
  }

  // =====================================================
  // DOWNLOAD VIDEO
  // =====================================================

  private downloadVideoFromUrl(url: string, outputPath: string): Promise<void> {
    return new Promise((resolve, reject) => {

      const protocol = url.startsWith('https') ? https : http
      const file = fsSync.createWriteStream(outputPath)

      const request = (currentUrl: string) => {
        protocol.get(currentUrl, (res: any) => {

          if ([301, 302, 303].includes(res.statusCode)) {
            file.destroy()
            try { fsSync.unlinkSync(outputPath) } catch {}
            return request(res.headers.location)
          }

          if (res.statusCode !== 200) {
            reject(new Error(`HTTP ${res.statusCode}`))
            return
          }

          res.pipe(file)

          file.on('finish', () => {
            file.close()
            resolve()
          })

          file.on('error', err => {
            file.destroy()
            reject(err)
          })
        }).on('error', reject)
      }

      request(url)
    })
  }

  // =====================================================
  // APPLY FILTERS + TRIM
  // =====================================================

  private applyFiltersAndTrim(
    inputPath: string,
    outputPath: string,
    filters: any,
    trimData: any
  ): Promise<number> {

    return new Promise((resolve, reject) => {

      const startTime = Date.now()

      const duration = trimData.end - trimData.start
      if (duration <= 0) {
        reject(new Error('Invalid trim duration'))
        return
      }

      // WINDOWS SAFE PATHS
      const safeInput = this.normalizePathForFFmpeg(inputPath)
      const safeOutput = this.normalizePathForFFmpeg(outputPath)

      console.log('Input:', safeInput)
      console.log('Output:', safeOutput)

      let command = ffmpeg(safeInput)

      const filtersArray = this.buildFFmpegFilters(filters)

      if (filtersArray.length) {
        console.log('Applying filters:', filtersArray.join(', '))
        command = command.videoFilters(filtersArray)
      }

      if (trimData.start > 0) {
        command = command.seekInput(trimData.start)
      }

      command
        .format('mp4')
        .videoCodec('libx264')
        .audioCodec('aac')
        .audioChannels(2)
        .audioFrequency(44100)
        .outputOptions([
          '-preset ultrafast',
          '-crf 23',
          '-movflags +faststart',
          '-pix_fmt yuv420p',
          '-y'
        ])
        .duration(duration)
        .on('start', cmd => console.log('FFmpeg started'))
        .on('progress', p => {
          if (p.percent) {
            console.log(`Progress ${p.percent.toFixed(1)}%`)
          }
        })
        .on('end', () => {
          console.log('✅ Processing complete')
          resolve(Date.now() - startTime)
        })
        .on('error', (err, stdout, stderr) => {
          console.error('FFmpeg error:', err.message)
          if (stderr) console.error(stderr.slice(0, 400))
          reject(err)
        })
        .save(safeOutput)
    })
  }

  // =====================================================
  // WINDOWS PATH FIX
  // =====================================================

  private normalizePathForFFmpeg(filePath: string): string {
    return filePath.replace(/\\/g, '/')
  }

  // =====================================================
  // FILTER BUILDER (CORRECT FFmpeg SYNTAX)
  // =====================================================

  private buildFFmpegFilters(filters: any): string[] {

    const result: string[] = []

    const eq: string[] = []

    if (filters.brightness && filters.brightness !== 100) {
      eq.push(`brightness=${(filters.brightness - 100) / 100}`)
    }

    if (filters.contrast && filters.contrast !== 100) {
      eq.push(`contrast=${filters.contrast / 100}`)
    }

    if (filters.saturation && filters.saturation !== 100) {
      eq.push(`saturation=${filters.saturation / 100}`)
    }

    if (eq.length) result.push(`eq=${eq.join(':')}`)

    if (filters.hue && filters.hue !== 0) {
      result.push(`hue=h=${filters.hue}`)
    }

    if (filters.blur && filters.blur > 0) {
      result.push(`boxblur=${filters.blur}`)
    }

    if (filters.sharpen && filters.sharpen !== 100) {
      const amount = 1 + (filters.sharpen - 100) / 100
      result.push(`unsharp=5:5:${amount}`)
    }

    if (filters.opacity && filters.opacity !== 100) {
      result.push(`format=yuva420p,colorchannelmixer=aa=${filters.opacity / 100}`)
    }

    return result
  }
}
