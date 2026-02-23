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

    const baseDir = app.tmpPath()
    const uniqueId = Date.now().toString()
    let tempDir: string | null = null

    try {
      tempDir = path.join(baseDir, `finalize-${uniqueId}`)

      await fs.mkdir(tempDir, { recursive: true })

      const test = path.join(tempDir, '.test')
      await fs.writeFile(test, 'ok')
      await fs.unlink(test)

      const inputPath = path.join(tempDir, 'input.mp4')
      const outputPath = path.join(tempDir, 'output.mp4')

      await this.downloadVideoFromUrl(videoUrl, inputPath)

      const inputStats = await fs.stat(inputPath)

      const processingTime = await this.applyFiltersAndTrim(
        inputPath,
        outputPath,
        filters,
        trimData
      )

      const outputStats = await fs.stat(outputPath)

      const uploaded = await cloudinary.uploader.upload(outputPath, {
        resource_type: 'video',
        folder: 'streaming/videos/processed',
        public_id: `finalized-${videoId || uniqueId}`,
        quality: 'auto',
        fetch_format: 'auto',
      })

      const finalDuration = trimData.end - trimData.start

      return {
        videoId: uploaded.public_id,
        finalUrl: uploaded.secure_url,
        processingStatus: 'completed',
        duration: finalDuration,
        appliedFilters: filters,
        processingTime,
        uploaded,
      }
    } catch (error: any) {
      console.error('❌ Finalization failed:', error.message)
      throw error
    } finally {
      if (tempDir) {
        try {
          await fs.rm(tempDir, { recursive: true, force: true })
        } catch (e) {
          console.warn('⚠️ Cleanup failed (non-critical)')
        }
      }
    }
  }

  private downloadVideoFromUrl(url: string, outputPath: string): Promise<void> {
    return new Promise((resolve, reject) => {
      const protocol = url.startsWith('https') ? https : http
      const writeStream = fsSync.createWriteStream(outputPath)

      const makeRequest = (currentUrl: string) => {
        protocol
          .get(currentUrl, (response: any) => {
            // Handle redirects
            if (response.statusCode === 301 || response.statusCode === 302 || response.statusCode === 303) {
              writeStream.destroy()
              try {
                fsSync.unlinkSync(outputPath)
              } catch (e) {}
              return makeRequest(response.headers.location)
            }

            if (response.statusCode !== 200) {
              writeStream.destroy()
              try {
                fsSync.unlinkSync(outputPath)
              } catch (e) {}
              reject(new Error(`HTTP ${response.statusCode}`))
              return
            }

            response.pipe(writeStream)

            writeStream.on('finish', () => {
              writeStream.close()
              resolve()
            })

            writeStream.on('error', (err: any) => {
              writeStream.destroy()
              try {
                fsSync.unlinkSync(outputPath)
              } catch (e) {}
              reject(err)
            })

            response.on('error', (err: any) => {
              writeStream.destroy()
              try {
                fsSync.unlinkSync(outputPath)
              } catch (e) {}
              reject(err)
            })
          })
          .on('error', (err: any) => {
            writeStream.destroy()
            try {
              fsSync.unlinkSync(outputPath)
            } catch (e) {}
            reject(err)
          })
      }

      makeRequest(url)
    })
  }

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

      const safeInput = this.normalizePathForFFmpeg(inputPath)
      const safeOutput = this.normalizePathForFFmpeg(outputPath)

      let command = ffmpeg(safeInput)

      const filtersArray = this.buildFFmpegFilters(filters)

      if (filtersArray.length) {
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
          '-y',
        ])
        .duration(duration)
        .on('start', () => console.log('   FFmpeg started'))
        .on('progress', (p) => {
          if (p.percent) {
            console.log(`   Progress: ${p.percent.toFixed(1)}%`)
          }
        })
        .on('end', () => {
          console.log('   ✅ Processing complete')
          resolve(Date.now() - startTime)
        })
        .on('error', (err, stdout, stderr) => {
          console.error('   ❌ FFmpeg error:', err.message)
          if (stderr) console.error('   STDERR:', stderr.slice(0, 400))
          reject(err)
        })
        .save(safeOutput)
    })
  }

  
  private normalizePathForFFmpeg(filePath: string): string {
    return filePath.replace(/\\/g, '/')
  }

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