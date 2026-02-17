import { cuid } from '@adonisjs/core/helpers'
import app from '@adonisjs/core/services/app'
import { exec } from 'node:child_process'
import { promisify } from 'node:util'
import { existsSync, createReadStream, createWriteStream, statSync } from 'node:fs'
import { unlink } from 'node:fs/promises'
import { createGzip, createGunzip } from 'node:zlib'
import { pipeline } from 'node:stream/promises'
import path from 'node:path'

const execAsync = promisify(exec)

export type VideoQuality    = 'lossless' | 'high' | 'medium' | 'low'
export type VideoResolution = '360p' | '480p' | '720p' | '1080p' | '1440p' | '4k'
export type EnhanceType     = 'denoise' | 'sharpen' | 'stabilize' | 'hdr' | 'none'

export interface ConvertOptions {
  fileName:     string           // e.g. "abc123.mp4" (stored as "abc123.mp4.gz")
  outputFormat: string           // e.g. "mkv"
  quality:      VideoQuality
  resolution?:  VideoResolution  // optional: scale the video
  enhance?:     EnhanceType      // optional: apply a visual enhancement filter
}

export interface ConvertResult {
  originalFile:    string
  convertedFile:   string
  outputFormat:    string
  quality:         string
  resolution:      string
  enhance:         string
  originalSizeMB:  string
  convertedSizeMB: string
  savedMB:         string
  compressionRate: string
  convertedAt:     string
  downloadPath:    string
}


const RESOLUTION_MAP: Record<VideoResolution, string> = {
  '360p':  'scale=-2:360',   //  640×360  — mobile / low bandwidth
  '480p':  'scale=-2:480',   //  854×480  — SD
  '720p':  'scale=-2:720',   // 1280×720  — HD
  
  '1080p': 'scale=-2:1080',  // 1920×1080 — Full HD
  '1440p': 'scale=-2:1440',  // 2560×1440 — QHD / HD+
  '4k':    'scale=-2:2160',  // 3840×2160 — 4K UHD
}


const ENHANCE_MAP: Record<EnhanceType, string> = {
  // Remove grain/noise — great for old or low-light footage
  denoise:    'hqdn3d=4:3:6:4.5',

  // Sharpen edges — makes footage look crisper
  sharpen:    'unsharp=5:5:1.0:5:5:0.5',

  // Deshake (software stabilization) — reduces camera shake
  stabilize:  'deshake',

  // Simulate HDR look — boosts contrast and vibrance
  hdr:        'eq=contrast=1.2:brightness=0.03:saturation=1.4',

  // No enhancement — pass-through
  none:       '',
}


export default class VideoService {

  // Directories
  private uploadsDir()   { return app.makePath('storage/videos/uploads') }
  private convertedDir() { return app.makePath('storage/videos/converted') }
  private tempDir()      { return app.makePath('storage/videos/temp') }

  private buildVfString(resolution?: VideoResolution, enhance?: EnhanceType): string {
    const filters: string[] = []

    if (resolution && RESOLUTION_MAP[resolution]) {
      filters.push(RESOLUTION_MAP[resolution])
    }

    if (enhance && enhance !== 'none' && ENHANCE_MAP[enhance]) {
      filters.push(ENHANCE_MAP[enhance])
    }

    return filters.length > 0 ? `-vf "${filters.join(',')}"` : ''
  }
  
  private getCodecSettings(format: string, quality: VideoQuality): string {
    const map: Record<string, Record<VideoQuality, string>> = {
      mp4: {
        lossless: '-c:v libx264 -crf 0  -preset veryslow -c:a aac -b:a 192k',
        high:     '-c:v libx264 -crf 18 -preset slow     -c:a aac -b:a 192k',
        medium:   '-c:v libx264 -crf 26 -preset medium   -c:a aac -b:a 128k',
        low:      '-c:v libx264 -crf 32 -preset veryfast  -c:a aac -b:a  96k',
      },
      mkv: {
        // H.265 gives ~40% better compression than H.264 at same CRF
        lossless: '-c:v libx265 -x265-params lossless=1 -c:a aac -b:a 192k',
        high:     '-c:v libx265 -crf 22 -preset slow     -c:a aac -b:a 192k',
        medium:   '-c:v libx265 -crf 28 -preset medium   -c:a aac -b:a 128k',
        low:      '-c:v libx265 -crf 34 -preset veryfast  -c:a aac -b:a  96k',
      },
      webm: {
        lossless: '-c:v libvpx-vp9 -lossless 1           -c:a libopus -b:a 192k',
        high:     '-c:v libvpx-vp9 -crf 20 -b:v 0        -c:a libopus -b:a 192k',
        medium:   '-c:v libvpx-vp9 -crf 33 -b:v 0        -c:a libopus -b:a 128k',
        low:      '-c:v libvpx-vp9 -crf 42 -b:v 0        -c:a libopus -b:a  96k',
      },
      avi: {
        lossless: '-c:v ffv1 -level 3                    -c:a pcm_s16le',
        high:     '-c:v libxvid -q:v 2                   -c:a libmp3lame -q:a 2',
        medium:   '-c:v libxvid -q:v 5                   -c:a libmp3lame -q:a 4',
        low:      '-c:v libxvid -q:v 10                  -c:a libmp3lame -q:a 6',
      },
      mov: {
        lossless: '-c:v prores_ks -profile:v 4444        -c:a copy',
        high:     '-c:v prores_ks -profile:v hq          -c:a copy',
        medium:   '-c:v prores_ks -profile:v lt          -c:a copy',
        low:      '-c:v prores_ks -profile:v proxy       -c:a copy',
      },
      flv: {
        lossless: '-c:v libx264 -crf 0  -c:a aac -b:a 192k',
        high:     '-c:v libx264 -crf 18 -c:a aac -b:a 192k',
        medium:   '-c:v libx264 -crf 26 -c:a aac -b:a 128k',
        low:      '-c:v libx264 -crf 32 -c:a aac -b:a  96k',
      },
      wmv: {
        lossless: '-c:v wmv2 -q:v 1 -c:a wmav2 -b:a 192k',
        high:     '-c:v wmv2 -q:v 2 -c:a wmav2 -b:a 192k',
        medium:   '-c:v wmv2 -q:v 5 -c:a wmav2 -b:a 128k',
        low:      '-c:v wmv2 -q:v 8 -c:a wmav2 -b:a  96k',
      },
      mpeg: {
        lossless: '-c:v mpeg2video -q:v 1 -c:a mp2 -b:a 192k',
        high:     '-c:v mpeg2video -q:v 2 -c:a mp2 -b:a 192k',
        medium:   '-c:v mpeg2video -q:v 5 -c:a mp2 -b:a 128k',
        low:      '-c:v mpeg2video -q:v 8 -c:a mp2 -b:a  96k',
      },
    }

    return map[format]?.[quality] ?? '-c:v copy -c:a copy'
  }

  // ── Gzip helpers (for disk storage only) ────────────────────────────────────

  async compressFile(filePath: string): Promise<string> {
    const out = `${filePath}.gz`
    await pipeline(
      createReadStream(filePath),
      createGzip({ level: 9 }),
      createWriteStream(out)
    )
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

  
  async convertVideo(options: ConvertOptions): Promise<ConvertResult> {
    const {
      fileName,
      outputFormat,
      quality,
      resolution = undefined,
      enhance    = 'none',
    } = options

    const gzInputPath = path.join(this.uploadsDir(), `${fileName}.gz`)
    if (!existsSync(gzInputPath)) {
      throw new Error(`Source file not found: ${fileName}.gz`)
    }

    // Step 1 — Decompress
    const tempIn = path.join(this.tempDir(), fileName)
    await this.decompressFile(gzInputPath, tempIn)

    // Step 2 — FFmpeg
    const outputFileName = `${cuid()}.${outputFormat}`
    const tempOut        = path.join(this.tempDir(), outputFileName)
    const codecSettings  = this.getCodecSettings(outputFormat, quality)
    const vfString       = this.buildVfString(resolution, enhance as EnhanceType)
    
    // -map 0 keeps all streams (video, audio, subtitles)
    // -movflags +faststart puts metadata at start of file (better for streaming)
    const ffmpegCmd = [
      `ffmpeg`,
      `-i "${tempIn}"`,
      codecSettings,
      vfString,
      `-map 0`,
      `-movflags +faststart`,
      `-y "${tempOut}"`,
    ].filter(Boolean).join(' ')

    await execAsync(ffmpegCmd)

    // Step 3 — Compress output and save to converted/
    const finalGzPath = path.join(this.convertedDir(), `${outputFileName}.gz`)
    await pipeline(
      createReadStream(tempOut),
      createGzip({ level: 9 }),
      createWriteStream(finalGzPath)
    )

    // Step 4 — Cleanup temp
    await unlink(tempIn)
    await unlink(tempOut)

    // Calculate sizes for response info
    const originalGzSize  = statSync(gzInputPath).size
    const convertedGzSize = statSync(finalGzPath).size
    const savedBytes      = originalGzSize - convertedGzSize
    const compressionRate = ((savedBytes / originalGzSize) * 100).toFixed(1)

    const toMB = (bytes: number) => (bytes / 1024 / 1024).toFixed(2)

    return {
      originalFile:    fileName,
      convertedFile:   outputFileName,
      outputFormat,
      quality,
      resolution:      resolution ?? 'original',
      enhance:         enhance    ?? 'none',
      originalSizeMB:  toMB(originalGzSize),
      convertedSizeMB: toMB(convertedGzSize),
      savedMB:         toMB(Math.max(savedBytes, 0)),
      compressionRate: `${compressionRate}%`,
      convertedAt:     new Date().toISOString(),
      downloadPath:    `/videos/download/${outputFileName}`,
    }
  }

  // ── Prepare for download ─────────────────────────────────────────────────────

  async prepareForDownload(
    fileName:  string,
    sourceDir: 'uploads' | 'converted'
  ): Promise<string> {
    const dir     = sourceDir === 'uploads' ? this.uploadsDir() : this.convertedDir()
    const gzPath  = path.join(dir, `${fileName}.gz`)

    if (!existsSync(gzPath)) {
      throw new Error(`File not found: ${fileName}`)
    }

    const tempPath = path.join(this.tempDir(), `dl_${cuid()}_${fileName}`)
    await this.decompressFile(gzPath, tempPath)
    return tempPath
  }

  async checkFFmpegInstalled(): Promise<boolean> {
    try { await execAsync('ffmpeg -version'); return true }
    catch { return false }
  }
}