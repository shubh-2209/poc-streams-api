import fs from 'fs/promises'
import fsSync from 'fs'
import path from 'path'
import https from 'https'
import http from 'http'
import app from '@adonisjs/core/services/app'
import { v2 as cloudinary } from 'cloudinary'
import ffmpeg from 'fluent-ffmpeg'

/**
 * VideoFinalizeService
 * Handles video processing with filters and trimming
 * 
 * Methods:
 * - finalizeVideoProcessing() - Main method
 * - downloadVideoFromUrl() - Download from Cloudinary
 * - applyFiltersAndTrim() - FFmpeg processing
 * - buildFFmpegFilters() - Filter conversion
 * - normalizePathForFFmpeg() - Windows path handling
 */
export default class VideoFinalizeService {
  /**
   * Main method: Process video with filters and trimming
   * 
   * Flow:
   * 1. Download video from Cloudinary
   * 2. Apply filters with FFmpeg
   * 3. Trim video to specified range
   * 4. Upload processed video back to Cloudinary
   */
  async finalizeVideoProcessing(
    videoUrl: string,
    filters: any,
    trimData: any,
    videoId?: string
  ): Promise<any> {
    console.log('🎬 Starting video finalization')
    console.log('   Input URL:', videoUrl.substring(0, 80) + '...')
    console.log('   Filters:', filters)
    console.log('   Trim: start=' + trimData.start + ', end=' + trimData.end)

    const baseDir = app.tmpPath()
    const uniqueId = Date.now().toString()
    let tempDir: string | null = null

    try {
      // ============ CREATE TEMP DIRECTORY ============
      tempDir = path.join(baseDir, `finalize-${uniqueId}`)
      console.log('📁 Temp directory:', tempDir)

      await fs.mkdir(tempDir, { recursive: true })

      // Verify write permission
      const test = path.join(tempDir, '.test')
      await fs.writeFile(test, 'ok')
      await fs.unlink(test)
      console.log('✅ Temp directory verified')

      const inputPath = path.join(tempDir, 'input.mp4')
      const outputPath = path.join(tempDir, 'output.mp4')

      // ============ DOWNLOAD VIDEO ============
      console.log('⬇️ Downloading video from Cloudinary...')
      await this.downloadVideoFromUrl(videoUrl, inputPath)

      const inputStats = await fs.stat(inputPath)
      console.log('✅ Download complete')
      console.log('   File size:', (inputStats.size / 1024 / 1024).toFixed(2), 'MB')

      // ============ PROCESS VIDEO ============
      console.log('🔧 Processing video with FFmpeg...')
      const processingTime = await this.applyFiltersAndTrim(
        inputPath,
        outputPath,
        filters,
        trimData
      )
      console.log('✅ Processing complete')
      console.log('   Time taken:', processingTime, 'ms')

      const outputStats = await fs.stat(outputPath)
      console.log('   Output size:', (outputStats.size / 1024 / 1024).toFixed(2), 'MB')

      // ============ UPLOAD TO CLOUDINARY ============
      console.log('☁️ Uploading to Cloudinary...')
      const uploaded = await cloudinary.uploader.upload(outputPath, {
        resource_type: 'video',
        folder: 'streaming/videos/processed',
        public_id: `finalized-${videoId || uniqueId}`,
        quality: 'auto',
        fetch_format: 'auto',
      })

      console.log('✅ Upload complete')
      console.log('   Public ID:', uploaded.public_id)

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
      // ============ CLEANUP ============
      if (tempDir) {
        try {
          console.log('🗑️ Cleaning up...')
          await fs.rm(tempDir, { recursive: true, force: true })
          console.log('✅ Cleanup complete')
        } catch (e) {
          console.warn('⚠️ Cleanup failed (non-critical)')
        }
      }
    }
  }

  /**
   * Download video from URL (Cloudinary)
   * Handles redirects and errors
   */
  private downloadVideoFromUrl(url: string, outputPath: string): Promise<void> {
    return new Promise((resolve, reject) => {
      const protocol = url.startsWith('https') ? https : http
      const writeStream = fsSync.createWriteStream(outputPath)

      console.log('   Fetching from Cloudinary...')

      const makeRequest = (currentUrl: string) => {
        protocol
          .get(currentUrl, (response: any) => {
            // Handle redirects
            if (response.statusCode === 301 || response.statusCode === 302 || response.statusCode === 303) {
              console.log('   Following redirect...')
              writeStream.destroy()
              try {
                fsSync.unlinkSync(outputPath)
              } catch (e) {}
              return makeRequest(response.headers.location)
            }

            // Check status
            if (response.statusCode !== 200) {
              writeStream.destroy()
              try {
                fsSync.unlinkSync(outputPath)
              } catch (e) {}
              reject(new Error(`HTTP ${response.statusCode}`))
              return
            }

            console.log('   Status: 200 OK')

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

  /**
   * Apply filters and trim using FFmpeg
   * Your existing code preserved
   */
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

      console.log('   Input:', safeInput)
      console.log('   Output:', safeOutput)

      let command = ffmpeg(safeInput)

      const filtersArray = this.buildFFmpegFilters(filters)

      if (filtersArray.length) {
        console.log('   Applying filters:', filtersArray.join(', '))
        command = command.videoFilters(filtersArray)
      }

      if (trimData.start > 0) {
        console.log('   Seeking to:', trimData.start, 'seconds')
        command = command.seekInput(trimData.start)
      }

      console.log('   Duration:', duration, 'seconds')

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

  /**
   * Normalize path for FFmpeg (Windows fix)
   */
  private normalizePathForFFmpeg(filePath: string): string {
    return filePath.replace(/\\/g, '/')
  }

  /**
   * Build FFmpeg filter string from frontend values
   * Your existing code preserved
   */
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