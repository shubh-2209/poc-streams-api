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

export interface AdvancedFilters {
  brightness?:  number  // -1.0 to 1.0    (0 = no change)
  contrast?:    number  // 0.0 to 3.0     (1 = no change)
  saturation?:  number  // 0.0 to 3.0     (1 = no change)
  gamma?:       number  // 0.1 to 3.0     (1 = no change)
  sharpen?:     number  // 0 to 10        (0 = off, higher = sharper)
  denoise?:     number  // 0 to 10        (0 = off, higher = more denoising)
  blur?:        number  // 0 to 10        (0 = off, higher = more blur)
  vignette?:    number  // 0.0 to 1.0     (0 = off, 1 = max vignette)
  rotate?:      number  // 0 | 90 | 180 | 270 (degrees clockwise)
  flipH?:       boolean // horizontal flip
  flipV?:       boolean // vertical flip
  blackWhite?:  boolean // convert to grayscale
  sepia?:       boolean // sepia tone effect
  negative?:    boolean // invert colors
  colorTemp?:   number  // -100 to 100 (negative = cooler, positive = warmer)
  vibrance?:    number  // 0.0 to 2.0 (1 = no change, higher = more vibrant)
}

export interface ConvertOptions {
  fileName:     string
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
}


const RESOLUTION_MAP: Record<VideoResolution, string> = {
  '360p':  'scale=-2:360',
  '480p':  'scale=-2:480',
  '720p':  'scale=-2:720',
  '1080p': 'scale=-2:1080',
  '1440p': 'scale=-2:1440',
  '4k':    'scale=-2:2160',
}


export default class VideoService {

  private uploadsDir()   { return app.makePath('storage/videos/uploads') }
  private convertedDir() { return app.makePath('storage/videos/converted') }
  private tempDir()      { return app.makePath('storage/videos/temp') }

  private buildFilterChain(
    resolution?: VideoResolution,
    filters?: AdvancedFilters
  ): { vfString: string; appliedFilters: string[] } {
    const chain: string[] = []
    const applied: string[] = []

    if (!filters) filters = {}

    if (filters.rotate && filters.rotate !== 0) {
      const rotMap: Record<number, string> = {
        90:  'transpose=1',      
        180: 'transpose=1,transpose=1',  
        270: 'transpose=2',      
      }
      if (rotMap[filters.rotate]) {
        chain.push(rotMap[filters.rotate])
        applied.push(`Rotate ${filters.rotate}°`)
      }
    }

    if (filters.flipH) {
      chain.push('hflip')
      applied.push('Flip horizontal')
    }

    if (filters.flipV) {
      chain.push('vflip')
      applied.push('Flip vertical')
    }


    if (resolution && RESOLUTION_MAP[resolution]) {
      chain.push(RESOLUTION_MAP[resolution])
      applied.push(`Scale to ${resolution}`)
    }


    const eqParts: string[] = []

    if (filters.brightness !== undefined && filters.brightness !== 0) {
      eqParts.push(`brightness=${filters.brightness}`)
      applied.push(`Brightness ${filters.brightness > 0 ? '+' : ''}${filters.brightness}`)
    }

    if (filters.contrast !== undefined && filters.contrast !== 1) {
      eqParts.push(`contrast=${filters.contrast}`)
      applied.push(`Contrast ${filters.contrast}x`)
    }

    if (filters.saturation !== undefined && filters.saturation !== 1) {
      eqParts.push(`saturation=${filters.saturation}`)
      applied.push(`Saturation ${filters.saturation}x`)
    }

    if (filters.gamma !== undefined && filters.gamma !== 1) {
      eqParts.push(`gamma=${filters.gamma}`)
      applied.push(`Gamma ${filters.gamma}`)
    }

    if (eqParts.length > 0) {
      chain.push(`eq=${eqParts.join(':')}`)
    }

    if (filters.colorTemp !== undefined && filters.colorTemp !== 0) {
      const temp = filters.colorTemp / 100  // normalize to -1..1
      if (temp > 0) {
        chain.push(`colorchannelmixer=rr=${1 + temp * 0.3}:bb=${1 - temp * 0.3}`)
        applied.push(`Warm tone +${filters.colorTemp}`)
      } else if (temp < 0) {
        chain.push(`colorchannelmixer=rr=${1 + temp * 0.3}:bb=${1 - temp * 0.3}`)
        applied.push(`Cool tone ${filters.colorTemp}`)
      }
    }

    if (filters.vibrance !== undefined && filters.vibrance !== 1) {
      chain.push(`vibrance=intensity=${filters.vibrance}`)
      applied.push(`Vibrance ${filters.vibrance}x`)
    }


    if (filters.denoise !== undefined && filters.denoise > 0) {
      const strength = filters.denoise  // 0-10 scale
      chain.push(`hqdn3d=${strength}:${strength * 0.75}:${strength * 1.5}:${strength * 1.125}`)
      applied.push(`Denoise ${filters.denoise}/10`)
    }

    if (filters.sharpen !== undefined && filters.sharpen > 0) {
      const amount = filters.sharpen / 10  
      chain.push(`unsharp=5:5:${amount}:5:5:${amount * 0.5}`)
      applied.push(`Sharpen ${filters.sharpen}/10`)
    }

    if (filters.blur !== undefined && filters.blur > 0) {
      const radius = Math.ceil(filters.blur * 2)  
      chain.push(`boxblur=${radius}:1`)
      applied.push(`Blur ${filters.blur}/10`)
    }

    if (filters.vignette !== undefined && filters.vignette > 0) {
      const angle = Math.PI / 3  
      chain.push(`vignette=angle=${angle}:a=${filters.vignette}`)
      applied.push(`Vignette ${(filters.vignette * 100).toFixed(0)}%`)
    }

    if (filters.blackWhite) {
      chain.push('hue=s=0')
      applied.push('Black & white')
    }

    if (filters.sepia) {
      chain.push('colorchannelmixer=.393:.769:.189:0:.349:.686:.168:0:.272:.534:.131')
      applied.push('Sepia tone')
    }

    if (filters.negative) {
      chain.push('negate')
      applied.push('Negative')
    }

    const vfString = chain.length > 0 ? `-vf "${chain.join(',')}"` : ''

    return { vfString, appliedFilters: applied }
  }

  private getCodecSettings(format: string, quality: VideoQuality): string {
    const map: Record<string, Record<VideoQuality, string>> = {
      mp4: {
        lossless: '-c:v libx264 -crf 0  -preset veryslow -c:a aac -b:a 192k',
        high:     '-c:v libx264 -crf 18 -preset slow     -c:a aac -b:a 192k',
        medium:   '-c:v libx264 -crf 26 -preset medium   -c:a aac -b:a 128k',
        low:      '-c:v libx264 -crf 32 -preset veryfast -c:a aac -b:a  96k',
      },
      mkv: {
        lossless: '-c:v libx265 -x265-params lossless=1 -c:a aac -b:a 192k',
        high:     '-c:v libx265 -crf 22 -preset slow     -c:a aac -b:a 192k',
        medium:   '-c:v libx265 -crf 28 -preset medium   -c:a aac -b:a 128k',
        low:      '-c:v libx265 -crf 34 -preset veryfast -c:a aac -b:a  96k',
      },
      webm: {
        lossless: '-c:v libvpx-vp9 -lossless 1           -c:a libopus -b:a 192k',
        high:     '-c:v libvpx-vp9 -crf 20 -b:v 0        -c:a libopus -b:a 192k',
        medium:   '-c:v libvpx-vp9 -crf 33 -b:v 0        -c:a libopus -b:a 128k',
        low:      '-c:v libvpx-vp9 -crf 42 -b:v 0        -c:a libopus -b:a  96k',
      },
      avi: {
        lossless: '-c:v ffv1 -level 3           -c:a pcm_s16le',
        high:     '-c:v libxvid -q:v 2          -c:a libmp3lame -q:a 2',
        medium:   '-c:v libxvid -q:v 5          -c:a libmp3lame -q:a 4',
        low:      '-c:v libxvid -q:v 10         -c:a libmp3lame -q:a 6',
      },
      mov: {
        lossless: '-c:v prores_ks -profile:v 4444 -c:a copy',
        high:     '-c:v prores_ks -profile:v hq   -c:a copy',
        medium:   '-c:v prores_ks -profile:v lt   -c:a copy',
        low:      '-c:v prores_ks -profile:v proxy -c:a copy',
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
      resolution,
      filters
    } = options

    const gzInputPath = path.join(this.uploadsDir(), `${fileName}.gz`)
    if (!existsSync(gzInputPath)) {
      throw new Error(`Source file not found: ${fileName}.gz`)
    }

    const tempIn = path.join(this.tempDir(), fileName)
    await this.decompressFile(gzInputPath, tempIn)

    const { vfString, appliedFilters } = this.buildFilterChain(resolution, filters)

    const outputFileName = `${cuid()}.${outputFormat}`
    const tempOut        = path.join(this.tempDir(), outputFileName)
    const codecSettings  = this.getCodecSettings(outputFormat, quality)

    const ffmpegCmd = [
      'ffmpeg',
      `-i "${tempIn}"`,
      codecSettings,
      vfString,
      '-map 0',
      '-movflags +faststart',
      `-y "${tempOut}"`,
    ].filter(Boolean).join(' ')

    await execAsync(ffmpegCmd)

    const finalGzPath = path.join(this.convertedDir(), `${outputFileName}.gz`)
    await pipeline(
      createReadStream(tempOut),
      createGzip({ level: 9 }),
      createWriteStream(finalGzPath)
    )

    await unlink(tempIn)
    await unlink(tempOut)

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
      filtersApplied:  appliedFilters,
      originalSizeMB:  toMB(originalGzSize),
      convertedSizeMB: toMB(convertedGzSize),
      savedMB:         toMB(Math.max(savedBytes, 0)),
      compressionRate: `${compressionRate}%`,
      convertedAt:     new Date().toISOString(),
      downloadPath:    `/videos/download/${outputFileName}`,
    }
  }


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