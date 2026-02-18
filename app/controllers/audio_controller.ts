import type { HttpContext } from '@adonisjs/core/http'
import { createReadStream, existsSync } from 'node:fs'
import app from '@adonisjs/core/services/app'
import Video from '#models/video'
import { AudioService } from '#services/audio_service'
import ResponseHelper from '../utils/response_helper.js'

export default class AudioController {
  async download({ params, response, i18n }: HttpContext) {
    const video = await Video.findOrFail(params.id)

    if (!video.audioPath) {
      return ResponseHelper.notFound(response, i18n.t('audio.audio_not_extracted'))
    }

    const absolutePath = app.makePath('storage', video.audioPath)

    if (!existsSync(absolutePath)) {
      return ResponseHelper.notFound(response, i18n.t('audio.audio_missing'))
    }

    response.header('Content-Type', 'audio/mpeg')
    response.header('Content-Disposition', `attachment; filename="${video.title}_audio.mp3"`)

    return response.stream(createReadStream(absolutePath))
  }

  async downloadClean({ params, response, i18n }: HttpContext) {
    const video = await Video.findOrFail(params.id)

    if (!video.cleanAudioPath) {
      return ResponseHelper.notFound(response, i18n.t('audio.clean_not_ready'))
    }

    const absolutePath = app.makePath('storage', video.cleanAudioPath)

    if (!existsSync(absolutePath)) {
      return ResponseHelper.notFound(response, i18n.t('audio.clean_missing'))
    }

    response.header('Content-Type', 'audio/mpeg')
    response.header('Content-Disposition', `attachment; filename="${video.title}_clean_audio.mp3"`)

    return response.stream(createReadStream(absolutePath))
  }

  async processAudio({ params, response, i18n }: HttpContext) {
    const video = await Video.findOrFail(params.id)
    const audioService = new AudioService()

    const videoAbsPath = app.makePath('storage', video.storagePath)

    if (!existsSync(videoAbsPath)) {
      return ResponseHelper.notFound(response, i18n.t('audio.source_video_not_found'))
    }

    try {
      const audioRelPath = video.storagePath.replace(/\.[^.]+$/, '_audio.mp3')
      const audioAbsPath = app.makePath('storage', audioRelPath)
      await audioService.extractAudio(videoAbsPath, audioAbsPath)

      const cleanRelPath = video.storagePath.replace(/\.[^.]+$/, '_clean.mp3')
      const cleanAbsPath = app.makePath('storage', cleanRelPath)
      await audioService.removeNoise(audioAbsPath, cleanAbsPath)

      await video
        .merge({
          audioPath: audioRelPath,
          cleanAudioPath: cleanRelPath,
          status: 'ready',
        })
        .save()

      return ResponseHelper.success(response, i18n.t('audio.processing_complete'), {
        audioUrl: `/api/videos/${video.id}/audio`,
        cleanAudioUrl: `/api/videos/${video.id}/audio/clean`,
      })
    } catch (error) {
      await video
        .merge({
          status: 'failed',
          errorMessage: error.message,
        })
        .save()

      return ResponseHelper.serverError(response, i18n.t('audio.processing_failed'), {
        details: error.message,
        hint: i18n.t('audio.ffmpeg_hint'),
      })
    }
  }
}
