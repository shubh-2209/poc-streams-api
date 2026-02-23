  import { promises as fs } from 'fs'
  import path from 'path'
  import ffmpeg from 'fluent-ffmpeg'

  import SpriteService from '#services/sprite_service'
  import FFmpegFilterBuilder from '#services/f_fmpeg_filter_builder_service'

  type TrimData = {
    start?: number
    end?: number
  }

  type ProcessOptions = {
    inputPath: string
    tempDir: string
    filters?: any
    trimData?: TrimData
  }

  export default class VideoProcessorService {
  
    async process({ inputPath, tempDir, filters, trimData }: ProcessOptions) {
      await fs.mkdir(tempDir, { recursive: true })

      const outputVideo = path.join(tempDir, 'processed.mp4')
      const spritePath = path.join(tempDir, 'sprite.webp')

      let finalVideoPath = inputPath

      if (filters || trimData) {
        await this.applyFiltersAndTrim(inputPath, outputVideo, filters, trimData)
        finalVideoPath = outputVideo
      }

      await fs.access(finalVideoPath)

      const duration = await this.getDuration(finalVideoPath)

      const spriteService = new SpriteService()
      const spriteMeta = await spriteService.generate(
        finalVideoPath,
        spritePath,
        duration
      )

      return {
        videoPath: finalVideoPath,
        spritePath,
        spriteMeta,
        duration,
      }
    }

    private getDuration(file: string): Promise<number> {
      return new Promise((resolve, reject) => {
        ffmpeg.ffprobe(file, (err, data) => {
          if (err) return reject(err)
          resolve(data?.format?.duration ?? 0)
        })
      })
    }

    private applyFiltersAndTrim(
      input: string,
      output: string,
      filters?: any,
      trimData?: TrimData
    ): Promise<void> {
      return new Promise((resolve, reject) => {
        const builder = new FFmpegFilterBuilder()
        const videoFilters = builder.build(filters)

        let cmd = ffmpeg(input)

        if (videoFilters?.length) {
          cmd.videoFilters(videoFilters)
        }

        if (trimData?.start !== undefined) {
          cmd.seekInput(trimData.start)
        }

        let duration: number | undefined
        if (
          trimData?.start !== undefined &&
          trimData?.end !== undefined
        ) {
          duration = trimData.end - trimData.start

          if (duration <= 0) {
            return reject(new Error('Invalid trim duration'))
          }
        }

        cmd
          .videoCodec('libx264')
          .audioCodec('aac')
          .outputOptions([
            '-preset veryfast',
            '-crf 20',
            '-movflags +faststart',
          ])

        if (duration !== undefined) {
          cmd.duration(duration)
        }

        cmd
          .on('end', () => resolve())
          .on('error', (err) => reject(err))
          .save(output)
      })
    }
  }