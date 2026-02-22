import { cuid } from '@adonisjs/core/helpers'
import app from '@adonisjs/core/services/app'
import { exec } from 'node:child_process'
import { promisify } from 'node:util'
import { createReadStream, createWriteStream, statSync, existsSync } from 'node:fs'
import { unlink, mkdir } from 'node:fs/promises'
import { createGzip, createGunzip } from 'node:zlib'
import { pipeline } from 'node:stream/promises'
import path from 'node:path'
import https from 'node:https'
import http from 'node:http'
import { MultipartFile } from '@adonisjs/core/types/bodyparser'
import Video from '#models/video'
import { DateTime } from 'luxon'
import {
  uploadVideoToCloudinary,
  deleteVideoFromCloudinary,
} from './cloudinary_service.js'
import cloudinary from './cloudinary_service.js'

const execAsync = promisify(exec)

export type VideoQuality    = 'lossless' | 'high' | 'medium' | 'low'
export type VideoResolution = '360p' | '480p' | '720p' | '1080p' | '1440p' | '4k'

export interface AdvancedFilters {
  brightness?:  number
  contrast?:    number
  saturation?:  number
  gamma?:       number
  sharpen?:     number
  denoise?:     number
  blur?:        number
  vignette?:    number
  rotate?:      number
  flipH?:       boolean
  flipV?:       boolean
  blackWhite?:  boolean
  sepia?:       boolean
  negative?:    boolean
  colorTemp?:   number
  vibrance?:    number
}

export interface ConvertOptions {
  videoId:      number
  outputFormat: string
  quality:      VideoQuality
  resolution?:  VideoResolution
  filters?:     AdvancedFilters
}

export interface ConvertResult {
  originalFile:    string
  convertedFile:   string
  outputFormat:    string
  quality:         string
  resolution:      string
  filtersApplied:  string[]
  originalSizeMB:  string
  convertedSizeMB: string
  savedMB:         string
  compressionRate: string
  convertedAt:     string
  downloadPath:    string
  id:              number
}

const RESOLUTION_MAP: Record<VideoResolution, string> = {
  '360p':  'scale=-2:360',
  '480p':  'scale=-2:480',
  '720p':  'scale=-2:720',
  '1080p': 'scale=-2:1080',
  '1440p': 'scale=-2:1440',
  '4k':    'scale=-2:2160',
}

export interface VideoPayload {
  type?:      'reel' | 'video'
  userId?: string
  sortType? : 'asc' | 'desc'
}

export default class VideoService {

  private tmpDir()       { return app.makePath('storage/videos/tmp') }
  private convertedDir() { return app.makePath('storage/videos/converted') }
  private tempDir()      { return app.makePath('storage/videos/temp') }

  private async ensureDirs() {
    await Promise.all([
      mkdir(this.tmpDir(),       { recursive: true }),
      mkdir(this.convertedDir(), { recursive: true }),
      mkdir(this.tempDir(),      { recursive: true }),
    ])
  }

  async getAllData( payload:VideoPayload ){
 
    const { type ,userId,sortType} = payload;
 
    let videoQuery = Video.query();
 
 
    if(userId){
      videoQuery.where( 'user_id' , userId)
    }
 
    if(type){
      videoQuery.where( 'type' , type)
    }
 
    // if(sortType){
    //   videoQuery.orderBy('created_at',sortType)
    // }
    videoQuery.orderBy('created_at', sortType ?? 'desc')

 
    return await videoQuery;
  }

  // ─── UPLOAD → Cloudinary ──────────────────────────────────────────────────────

  async ingestUpload(videoFile: MultipartFile, userId: number, title?: string) {
    await this.ensureDirs()

    const ext     = videoFile.extname ?? 'mp4'
    const base    = cuid()
    const rawPath = path.join(this.tmpDir(), `${base}.${ext}`)

    await videoFile.move(this.tmpDir(), { name: `${base}.${ext}` })

    const video = await Video.create({
      userId,
      title:            title ?? videoFile.clientName ?? 'Untitled',
      originalFilename: videoFile.clientName ?? 'unknown',
      storagePath:      rawPath,
      fileSize:         videoFile.size ?? 0,
      mimeType:         `video/${ext}`,
      extension:        ext,
      status:           'uploading',
      uploadTime:       DateTime.now(),
    })

    try {
      const result = await uploadVideoToCloudinary(rawPath, videoFile.clientName ?? `video_${Date.now()}`)
      video.merge({
        cloudinaryUrl:          result.url,
        cloudinaryStreamingUrl: result.streamingUrl,
        cloudinaryPublicId:     result.publicId,
        duration:               result.duration,
        status:                 'uploaded',
      })
      await video.save()
      return video
    } catch (error) {
      video.merge({ status: 'failed', errorMessage: String(error.message) })
      await video.save()
      throw error
    } finally {
      await unlink(rawPath).catch(() => {})
    }
  }

  async removeVideo(publicId: string) { return deleteVideoFromCloudinary(publicId) }

  // ─── CONVERT → local .gz ─────────────────────────────────────────────────────

  async convertVideo(options: ConvertOptions): Promise<ConvertResult> {
    await this.ensureDirs()
    const { videoId, outputFormat, quality, resolution, filters } = options

    const sourceVideo = await Video.findOrFail(videoId)
    if (!sourceVideo.cloudinaryUrl) throw new Error('Source video has no Cloudinary URL')

    const srcExt    = sourceVideo.extension ?? 'mp4'
    const base      = cuid()
    const rawTempIn = path.join(this.tempDir(), `${base}.${srcExt}`)

    console.log(`⬇️  Downloading source from Cloudinary...`)
    await this.fetchUrlToFile(sourceVideo.cloudinaryUrl, rawTempIn)
    const sourceSizeBytes = statSync(rawTempIn).size

    const { vfString, appliedFilters } = this.buildFilterChain(resolution, filters)
    const outputFileName = `${cuid()}.${outputFormat}`
    const rawTempOut     = path.join(this.tempDir(), outputFileName)

    const ffmpegCmd = [
      'ffmpeg', `-i "${rawTempIn}"`,
      this.getCodecSettings(outputFormat, quality),
      vfString, '-map 0', '-movflags +faststart', `-y "${rawTempOut}"`,
    ].filter(Boolean).join(' ')

    console.log(`🎬 Running FFmpeg...`)
    await execAsync(ffmpegCmd)
    await unlink(rawTempIn)

    const gzPath = path.join(this.convertedDir(), `${outputFileName}.gz`)
    console.log(`🗜️  Compressing...`)
    await this.compressToFile(rawTempOut, gzPath)
    await unlink(rawTempOut)

    const convertedGzSize = statSync(gzPath).size

    const convertedVideo = await Video.create({
      userId:           sourceVideo.userId,
      title:            `${sourceVideo.title} → ${outputFormat.toUpperCase()}`,
      originalFilename: outputFileName,
      storagePath:      gzPath,          // ← local .gz path stored here
      fileSize:         convertedGzSize,
      mimeType:         `video/${outputFormat}`,
      extension:        outputFormat,
      status:           'uploaded',
      uploadTime:       DateTime.now(),
    })

    const savedBytes = sourceSizeBytes - convertedGzSize
    const toMB       = (b: number) => (b / 1024 / 1024).toFixed(2)

    return {
      originalFile:    sourceVideo.originalFilename,
      convertedFile:   outputFileName,
      outputFormat,    quality,
      resolution:      resolution ?? 'original',
      filtersApplied:  appliedFilters,
      originalSizeMB:  toMB(sourceSizeBytes),
      convertedSizeMB: toMB(convertedGzSize),
      savedMB:         toMB(Math.max(savedBytes, 0)),
      compressionRate: `${((savedBytes / sourceSizeBytes) * 100).toFixed(1)}%`,
      convertedAt:     new Date().toISOString(),
      downloadPath:    `/videos/${convertedVideo.id}/download`,
      id : convertedVideo.id
    }
  }

  // ─── DOWNLOAD ─────────────────────────────────────────────────────────────────
  //
  // Handles TWO cases:
  //
  // CASE 1 — New records (storagePath = local .gz path)
  //   → decompress local .gz → serve
  //
  // CASE 2 — Old records (storagePath empty, cloudinaryUrl = raw .gz URL)
  //   → use Cloudinary SDK to generate authenticated download URL
  //   → fetch .gz → decompress → serve

  async prepareDownload(
    videoId: number
  ): Promise<{ tempPath: string; fileName: string; mimeType: string }> {
    await this.ensureDirs()

    const video = await Video.findOrFail(videoId)

    const ext     = video.extension ?? 'mp4'
    const rawTemp = path.join(this.tempDir(), `${cuid()}.${ext}`)

    // ── CASE 1: Local .gz file ─────────────────────────────────────────────────
    if (video.storagePath && existsSync(video.storagePath)) {
      console.log(`📂 Decompressing local file: ${video.storagePath}`)
      await this.decompressFile(video.storagePath, rawTemp)
      return this.buildDownloadResult(rawTemp, video.originalFilename, videoId, ext)
    }

    // ── CASE 2: Old Cloudinary raw .gz record ──────────────────────────────────
    if (video.cloudinaryPublicId) {
      console.log(`☁️  Fetching from Cloudinary via SDK: ${video.cloudinaryPublicId}`)

      // Cloudinary SDK download — authenticated, bypasses 401
      const gzTemp = path.join(this.tempDir(), `${cuid()}.${ext}.gz`)
      await this.downloadFromCloudinarySdk(video.cloudinaryPublicId, gzTemp)

      console.log(`📂 Decompressing...`)
      await this.decompressFile(gzTemp, rawTemp)
      await unlink(gzTemp)

      return this.buildDownloadResult(rawTemp, video.originalFilename, videoId, ext)
    }

    throw new Error('Video has no local file and no Cloudinary publicId')
  }

  // ─── Cloudinary SDK download (authenticated) ──────────────────────────────────
  // Uses cloudinary.api to get a proper admin download URL — no 401

  private async downloadFromCloudinarySdk(publicId: string, destPath: string): Promise<void> {
    return new Promise((resolve, reject) => {
      // Generate a signed admin URL using the SDK
      // This uses your api_key + api_secret so it always works
      const url = cloudinary.utils.private_download_url(
        publicId.replace(/\.gz$/, ''),   // strip .gz — SDK adds format separately
        'gz',
        {
          resource_type: 'raw',
          expires_at:    Math.floor(Date.now() / 1000) + 300,  // 5 min — plenty
        }
      )

      console.log(`🔐 SDK download URL: ${url}`)

      https.get(url, (res) => {
        if (res.statusCode === 301 || res.statusCode === 302) {
          res.resume()
          const loc = res.headers.location
          if (!loc) return reject(new Error('Redirect with no Location'))
          https.get(loc, (res2) => {
            if (res2.statusCode !== 200) {
              res2.resume()
              return reject(new Error(`SDK download failed: HTTP ${res2.statusCode}`))
            }
            const writer = createWriteStream(destPath)
            res2.on('error', (e) => { writer.destroy(); reject(e) })
            writer.on('finish', resolve)
            writer.on('error', reject)
            res2.pipe(writer)
          }).on('error', reject)
          return
        }
        if (res.statusCode !== 200) {
          res.resume()
          return reject(new Error(`SDK download failed: HTTP ${res.statusCode}`))
        }
        const writer = createWriteStream(destPath)
        res.on('error', (e) => { writer.destroy(); reject(e) })
        writer.on('finish', resolve)
        writer.on('error', reject)
        res.pipe(writer)
      }).on('error', reject)
    })
  }

  private buildDownloadResult(
    tempPath:     string,
    originalName: string | null,
    videoId:      number,
    ext:          string
  ) {
    const mimeMap: Record<string, string> = {
      mp4:  'video/mp4',   mkv:  'video/x-matroska',
      webm: 'video/webm',  avi:  'video/x-msvideo',
      mov:  'video/quicktime', flv: 'video/x-flv',
      wmv:  'video/x-ms-wmv',  mpeg: 'video/mpeg',
    }
    return {
      tempPath,
      fileName: originalName ?? `video_${videoId}.${ext}`,
      mimeType: mimeMap[ext] ?? 'application/octet-stream',
    }
  }

  // ─── uploadAndConvert (fully local) ──────────────────────────────────────────

  async ingestAndConvert(
    videoFile: MultipartFile, outputFormat: string, quality: VideoQuality,
    resolution?: VideoResolution, filters?: AdvancedFilters
  ): Promise<ConvertResult> {
    await this.ensureDirs()
    const uploadsDir = app.makePath('storage/videos/uploads')
    await mkdir(uploadsDir, { recursive: true })

    const fileName = `${cuid()}.${videoFile.extname}`
    const rawPath  = path.join(uploadsDir, fileName)
    await videoFile.move(uploadsDir, { name: fileName })

    const gzInputPath    = await this.compressToFile(rawPath, `${rawPath}.gz`)
    await unlink(rawPath)
    const originalGzSize = statSync(gzInputPath).size

    const rawTempIn = path.join(this.tempDir(), fileName)
    await this.decompressFile(gzInputPath, rawTempIn)

    const { vfString, appliedFilters } = this.buildFilterChain(resolution, filters)
    const outputFileName = `${cuid()}.${outputFormat}`
    const rawTempOut     = path.join(this.tempDir(), outputFileName)

    await execAsync([
      'ffmpeg', `-i "${rawTempIn}"`,
      this.getCodecSettings(outputFormat, quality),
      vfString, '-map 0', '-movflags +faststart', `-y "${rawTempOut}"`,
    ].filter(Boolean).join(' '))
    await unlink(rawTempIn)

    const finalGzPath = path.join(this.convertedDir(), `${outputFileName}.gz`)
    await this.compressToFile(rawTempOut, finalGzPath)
    await unlink(rawTempOut)

    const convertedGzSize = statSync(finalGzPath).size
    const savedBytes      = originalGzSize - convertedGzSize
    const toMB            = (b: number) => (b / 1024 / 1024).toFixed(2)

    return {
      originalFile: fileName, convertedFile: outputFileName, outputFormat, quality,
      resolution: resolution ?? 'original', filtersApplied: appliedFilters,
      originalSizeMB: toMB(originalGzSize), convertedSizeMB: toMB(convertedGzSize),
      savedMB: toMB(Math.max(savedBytes, 0)),
      compressionRate: `${((savedBytes / originalGzSize) * 100).toFixed(1)}%`,
      convertedAt: new Date().toISOString(),
      downloadPath: `/videos/download/${outputFileName}`,
    }
  }

  // ─── Compression helpers ──────────────────────────────────────────────────────

  async compressToFile(src: string, dest: string): Promise<string> {
    await pipeline(createReadStream(src), createGzip({ level: 9 }), createWriteStream(dest))
    return dest
  }

  async compressFile(filePath: string): Promise<string> {
    const out = `${filePath}.gz`
    await this.compressToFile(filePath, out)
    await unlink(filePath)
    return out
  }

  async decompressFile(gzPath: string, destPath: string): Promise<string> {
    await pipeline(
      createReadStream(gzPath),
      createGunzip(),
      createWriteStream(destPath)
    )
    return destPath
  }

  // ─── HTTP fetch (for Cloudinary video URLs) ───────────────────────────────────

  private async fetchUrlToFile(
    url:          string,
    destPath:     string,
    redirectDepth = 0
  ): Promise<void> {
    if (redirectDepth > 5) throw new Error('Too many redirects')

    const res = await new Promise<import('node:http').IncomingMessage>((resolve, reject) => {
      const client = url.startsWith('https') ? https : http
      client.get(url, resolve).on('error', reject)
    })

    if (res.statusCode === 301 || res.statusCode === 302) {
      res.resume()
      const loc = res.headers.location
      if (!loc) throw new Error('Redirect with no Location header')
      return this.fetchUrlToFile(loc, destPath, redirectDepth + 1)
    }

    if (res.statusCode !== 200) {
      res.resume()
      throw new Error(`Cloudinary fetch failed: HTTP ${res.statusCode}`)
    }

    await pipeline(res, createWriteStream(destPath))
  }

  async checkFFmpegInstalled(): Promise<boolean> {
    try { await execAsync('ffmpeg -version'); return true }
    catch { return false }
  }

  // ─── FFmpeg helpers ───────────────────────────────────────────────────────────

  private buildFilterChain(resolution?: VideoResolution, filters?: AdvancedFilters) {
    const chain: string[] = []
    const applied: string[] = []
    if (!filters) filters = {}

    if (filters.rotate && filters.rotate !== 0) {
      const rotMap: Record<number, string> = { 90: 'transpose=1', 180: 'transpose=1,transpose=1', 270: 'transpose=2' }
      if (rotMap[filters.rotate]) { chain.push(rotMap[filters.rotate]); applied.push(`Rotate ${filters.rotate}°`) }
    }
    if (filters.flipH) { chain.push('hflip');  applied.push('Flip horizontal') }
    if (filters.flipV) { chain.push('vflip');  applied.push('Flip vertical') }
    if (resolution && RESOLUTION_MAP[resolution]) { chain.push(RESOLUTION_MAP[resolution]); applied.push(`Scale to ${resolution}`) }

    const eqParts: string[] = []
    if (filters.brightness !== undefined && filters.brightness !== 0) { eqParts.push(`brightness=${filters.brightness}`); applied.push(`Brightness ${filters.brightness > 0 ? '+' : ''}${filters.brightness}`) }
    if (filters.contrast   !== undefined && filters.contrast   !== 1) { eqParts.push(`contrast=${filters.contrast}`);     applied.push(`Contrast ${filters.contrast}x`) }
    if (filters.saturation !== undefined && filters.saturation !== 1) { eqParts.push(`saturation=${filters.saturation}`); applied.push(`Saturation ${filters.saturation}x`) }
    if (filters.gamma      !== undefined && filters.gamma      !== 1) { eqParts.push(`gamma=${filters.gamma}`);           applied.push(`Gamma ${filters.gamma}`) }
    if (eqParts.length > 0) chain.push(`eq=${eqParts.join(':')}`)

    if (filters.colorTemp !== undefined && filters.colorTemp !== 0) {
      const t = filters.colorTemp / 100
      chain.push(`colorchannelmixer=rr=${1 + t * 0.3}:bb=${1 - t * 0.3}`)
      applied.push(t > 0 ? `Warm tone +${filters.colorTemp}` : `Cool tone ${filters.colorTemp}`)
    }
    if (filters.vibrance !== undefined && filters.vibrance !== 1) { chain.push(`vibrance=intensity=${filters.vibrance}`); applied.push(`Vibrance ${filters.vibrance}x`) }
    if (filters.denoise  !== undefined && filters.denoise  > 0)  { const s = filters.denoise; chain.push(`hqdn3d=${s}:${s * 0.75}:${s * 1.5}:${s * 1.125}`); applied.push(`Denoise ${s}/10`) }
    if (filters.sharpen  !== undefined && filters.sharpen  > 0)  { const a = filters.sharpen / 10; chain.push(`unsharp=5:5:${a}:5:5:${a * 0.5}`); applied.push(`Sharpen ${filters.sharpen}/10`) }
    if (filters.blur     !== undefined && filters.blur     > 0)  { chain.push(`boxblur=${Math.ceil(filters.blur * 2)}:1`); applied.push(`Blur ${filters.blur}/10`) }
    if (filters.vignette !== undefined && filters.vignette > 0)  { chain.push(`vignette=angle=${Math.PI / 3}:a=${filters.vignette}`); applied.push(`Vignette ${(filters.vignette * 100).toFixed(0)}%`) }
    if (filters.blackWhite) { chain.push('hue=s=0'); applied.push('Black & white') }
    if (filters.sepia)      { chain.push('colorchannelmixer=.393:.769:.189:0:.349:.686:.168:0:.272:.534:.131'); applied.push('Sepia tone') }
    if (filters.negative)   { chain.push('negate'); applied.push('Negative') }

    return { vfString: chain.length > 0 ? `-vf "${chain.join(',')}"` : '', appliedFilters: applied }
  }

  private getCodecSettings(format: string, quality: VideoQuality): string {
    const map: Record<string, Record<VideoQuality, string>> = {
      mp4:  { lossless: '-c:v libx264 -crf 0  -preset veryslow -c:a aac -b:a 192k', high: '-c:v libx264 -crf 18 -preset slow    -c:a aac -b:a 192k', medium: '-c:v libx264 -crf 26 -preset medium  -c:a aac -b:a 128k', low: '-c:v libx264 -crf 32 -preset veryfast -c:a aac -b:a  96k' },
      mkv:  { lossless: '-c:v libx265 -x265-params lossless=1  -c:a aac -b:a 192k', high: '-c:v libx265 -crf 22 -preset slow    -c:a aac -b:a 192k', medium: '-c:v libx265 -crf 28 -preset medium  -c:a aac -b:a 128k', low: '-c:v libx265 -crf 34 -preset veryfast -c:a aac -b:a  96k' },
      webm: { lossless: '-c:v libvpx-vp9 -lossless 1 -c:a libopus -b:a 192k',       high: '-c:v libvpx-vp9 -crf 20 -b:v 0 -c:a libopus -b:a 192k', medium: '-c:v libvpx-vp9 -crf 33 -b:v 0 -c:a libopus -b:a 128k', low: '-c:v libvpx-vp9 -crf 42 -b:v 0 -c:a libopus -b:a  96k' },
      avi:  { lossless: '-c:v ffv1 -level 3 -c:a pcm_s16le',                        high: '-c:v libxvid -q:v 2 -c:a libmp3lame -q:a 2', medium: '-c:v libxvid -q:v 5 -c:a libmp3lame -q:a 4', low: '-c:v libxvid -q:v 10 -c:a libmp3lame -q:a 6' },
      mov:  { lossless: '-c:v prores_ks -profile:v 4444 -c:a copy',                 high: '-c:v prores_ks -profile:v hq -c:a copy', medium: '-c:v prores_ks -profile:v lt -c:a copy', low: '-c:v prores_ks -profile:v proxy -c:a copy' },
      flv:  { lossless: '-c:v libx264 -crf 0  -c:a aac -b:a 192k',                 high: '-c:v libx264 -crf 18 -c:a aac -b:a 192k', medium: '-c:v libx264 -crf 26 -c:a aac -b:a 128k', low: '-c:v libx264 -crf 32 -c:a aac -b:a  96k' },
      wmv:  { lossless: '-c:v wmv2 -q:v 1 -c:a wmav2 -b:a 192k',                   high: '-c:v wmv2 -q:v 2 -c:a wmav2 -b:a 192k', medium: '-c:v wmv2 -q:v 5 -c:a wmav2 -b:a 128k', low: '-c:v wmv2 -q:v 8 -c:a wmav2 -b:a  96k' },
      mpeg: { lossless: '-c:v mpeg2video -q:v 1 -c:a mp2 -b:a 192k',               high: '-c:v mpeg2video -q:v 2 -c:a mp2 -b:a 192k', medium: '-c:v mpeg2video -q:v 5 -c:a mp2 -b:a 128k', low: '-c:v mpeg2video -q:v 8 -c:a mp2 -b:a  96k' },
    }
    return map[format]?.[quality] ?? '-c:v copy -c:a copy'
  }
}