import ffmpeg from 'fluent-ffmpeg'
import ffmpegStatic from 'ffmpeg-static'
import { promises as fs } from 'node:fs'
import { exec } from 'node:child_process'
import { promisify } from 'node:util'
import path from 'node:path'
 
const execAsync = promisify(exec)
 
if (ffmpegStatic) {
  ffmpeg.setFfmpegPath(ffmpegStatic)
  console.log('✅ FFmpeg path set:', ffmpegStatic)
}
 
export class AudioService {
 
  async extractAudio(videoPath: string, outputPath: string): Promise<void> {
    return new Promise((resolve, reject) => {
      ffmpeg(videoPath)
        .noVideo()
        .format('mp3')
        .audioBitrate(192)
        .output(outputPath)
        .on('end', () => {
          console.log('✅ Audio extracted:', outputPath)
          resolve()
        })
        .on('error', (err) => {
          console.error('extractAudio error:', err.message)
          reject(err)
        })
        .run()
    })
  }
 
  async removeNoise(inputPath: string, outputPath: string): Promise<void> {
    return new Promise((resolve, reject) => {
      ffmpeg(inputPath)
        .audioFilters(['afftdn=nf=-25', 'highpass=f=80', 'lowpass=f=8000', 'dynaudnorm=p=0.9:s=5'])
        .format('mp3')
        .audioBitrate(192)
        .output(outputPath)
        .on('end', () => {
          console.log('✅ Clean audio ready:', outputPath)
          resolve()
        })
        .on('error', (err) => {
          console.error('removeNoise error:', err.message)
          reject(err)
        })
        .run()
    })
  }
 
  async getMetadata(videoPath: string): Promise<{ duration: number; resolution: string; hasAudio: boolean }> {
    return new Promise((resolve, reject) => {
      ffmpeg.ffprobe(videoPath, (err, metadata) => {
        if (err) return reject(err)
        const videoStream = metadata.streams.find((s) => s.codec_type === 'video')
        const audioStream = metadata.streams.find((s) => s.codec_type === 'audio')
        resolve({
          duration:   Math.round(metadata.format.duration || 0),
          resolution: videoStream ? `${videoStream.width}x${videoStream.height}` : 'unknown',
          hasAudio:   !!audioStream,
        })
      })
    })
  }
 
  async generateThumbnail(videoPath: string, outputPath: string): Promise<void> {
    return new Promise((resolve, reject) => {
      const filename = path.basename(outputPath)
      const dir = path.dirname(outputPath)
      ffmpeg(videoPath)
        .screenshots({ timestamps: ['10%'], filename, folder: dir, size: '640x360' })
        .on('end', () => resolve())
        .on('error', reject)
    })
  }
 
  async generateSubtitles(videoPath: string, outputPath: string): Promise<void> {
    console.log('🎬 Starting subtitle generation...')
    const hasEmbedded = await this.extractEmbeddedSubtitles(videoPath, outputPath)
    if (hasEmbedded) { console.log('✅ Used embedded subtitles'); return }
    const hasWhisper = await this.checkWhisperInstalled()
    if (hasWhisper) { await this.generateWithWhisper(videoPath, outputPath); return }
    console.log('⚠️  No Whisper found, creating placeholder subtitles')
    await this.createPlaceholderSubtitles(outputPath)
  }
 
  private async checkWhisperInstalled(): Promise<boolean> {
    try { await execAsync('whisper --version', { timeout: 3000 }); return true } catch {}
    try { await execAsync('wsl whisper --version', { timeout: 3000 }); return true } catch {}
    return false
  }
 
  private async extractEmbeddedSubtitles(videoPath: string, outputPath: string): Promise<boolean> {
    return new Promise((resolve) => {
      ffmpeg(videoPath)
        .outputOptions(['-map 0:s:0', '-c:s srt'])
        .output(outputPath)
        .on('end', () => resolve(true))
        .on('error', () => resolve(false))
        .run()
    })
  }
 
  private async generateWithWhisper(videoPath: string, outputPath: string): Promise<void> {
    const tempAudioPath = outputPath.replace('.srt', '_temp.wav')
    try {
      await this.extractAudioForWhisper(videoPath, tempAudioPath)
      const outputDir = path.dirname(outputPath)
      const baseName = path.basename(tempAudioPath, '.wav')
      const wslAudioPath = await this.convertToWSLPath(tempAudioPath)
      const wslOutputDir = await this.convertToWSLPath(outputDir)
      let useWSL = false
      try { await execAsync('wsl whisper --version', { timeout: 2000 }); useWSL = true } catch {}
      const command = useWSL
        ? `wsl whisper "${wslAudioPath}" --model small --output_dir "${wslOutputDir}" --output_format srt`
        : `whisper "${tempAudioPath}" --model small --output_dir "${outputDir}" --output_format srt`
      await execAsync(command, { maxBuffer: 10 * 1024 * 1024, timeout: 600000 })
      const whisperOutput = path.join(outputDir, `${baseName}.srt`)
      if (whisperOutput !== outputPath) await fs.rename(whisperOutput, outputPath).catch(() => {})
      await fs.unlink(tempAudioPath).catch(() => {})
    } catch {
      await fs.unlink(tempAudioPath).catch(() => {})
      await this.createPlaceholderSubtitles(outputPath)
    }
  }
 
  private async convertToWSLPath(windowsPath: string): Promise<string> {
    try { const { stdout } = await execAsync(`wsl wslpath -u "${windowsPath}"`); return stdout.trim() }
    catch { return windowsPath }
  }
 
  private async extractAudioForWhisper(videoPath: string, outputPath: string): Promise<void> {
    return new Promise((resolve, reject) => {
      ffmpeg(videoPath)
        .noVideo()
        .audioCodec('pcm_s16le')
        .audioChannels(1)
        .audioFrequency(16000)
        .output(outputPath)
        .on('end', () => resolve())
        .on('error', reject)
        .run()
    })
  }
 
  private async createPlaceholderSubtitles(outputPath: string): Promise<void> {
    const placeholder = `1\n00:00:00,000 --> 00:00:05,000\n[Caption segment 1]\n\n2\n00:00:05,000 --> 00:00:10,000\n[Caption segment 2]\n`
    await fs.writeFile(outputPath, placeholder, 'utf-8')
  }
}