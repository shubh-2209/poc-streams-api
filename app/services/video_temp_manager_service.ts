  import app from '@adonisjs/core/services/app'
  import { promises as fs } from 'fs'
  import path from 'path'
  import { v4 as uuid } from 'uuid'
  import type { MultipartFile } from '@adonisjs/core/bodyparser'

  export default class VideoTempManager {
    static async create() {
      const dir = app.tmpPath(`video-${uuid()}`)
      await fs.mkdir(dir, { recursive: true })
      return dir
    }

    static async saveUploadedFile(file: MultipartFile, dir: string) {
      if (!file || !file.isValid) {
        throw new Error(file?.errors?.[0]?.message || 'Invalid file upload')
      }

      const ext = file.extname || 'mp4'
      const name = `${Date.now()}.${ext}`

      try {
        await file.move(dir, { name })
      } catch (error) {
        throw new Error(`Failed to move uploaded file: ${error.message}`)
      }

      return path.join(dir, name)
    }

    static async cleanup(dir: string) {
      try {
        await fs.rm(dir, { recursive: true, force: true })
      } catch {
      }
    }
  }