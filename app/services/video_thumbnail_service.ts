import fs from 'fs/promises'
import path from 'path'
import ffmpeg from 'fluent-ffmpeg'
import ffmpegStatic from 'ffmpeg-static'
import sharp from 'sharp'
import { v4 as uuid } from 'uuid'
import app from '@adonisjs/core/services/app'
import cloudinary from './cloudinary_service.js'

if (ffmpegStatic) {
    ffmpeg.setFfmpegPath(ffmpegStatic)
}

// ── Interfaces ────────────────────────────────────────────────

export interface SpriteInfo {
    path: string
    columns: number
    rows: number
    thumbWidth: number
    thumbHeight: number
    spriteWidth: number
    spriteHeight: number
}

export interface ThumbnailMeta {
    frameNo: number
    timeSecond: number
    timeLabel: string
}

export interface UploadVideoResult {
    videoId: string
    fileName: string
    videoUrl: string
    posterUrl: string
    duration: number
    durationFormatted: string
    thumbnailCount: number
    interval: number
    intervalLabel: string
    sprite: SpriteInfo
    thumbnails: ThumbnailMeta[]
}


export default class VideoThumbnailService {

    // ── Main: Upload video + generate sprite ──────────────────────
    async processVideoUpload(
        videoFile: any,
        customThumbnailFile?: any
    ): Promise<UploadVideoResult> {

        console.log('🎬 Starting video upload...')

        // Temporary folder
        const tempDir = app.tmpPath(`uploads/${uuid()}`)
        await fs.mkdir(tempDir, { recursive: true })

        const fileName = `${Date.now()}-${uuid()}.mp4`
        await videoFile.move(tempDir, { name: fileName })

        const videoPath = path.join(tempDir, fileName)

        // ───────── Upload VIDEO to Cloudinary ─────────
        console.log('☁ Uploading video to Cloudinary...')

        const uploadedVideo = await cloudinary.uploader.upload(videoPath, {
            resource_type: 'video',
            folder: 'streaming/videos',
        })

        const videoUrl = uploadedVideo.secure_url
        console.log('✅ Video uploaded to Cloudinary')


        const duration = await this.getVideoDuration(videoPath)
        if (duration <= 0) throw new Error('Invalid video duration')

        const { frameCount, interval } = this.calculateFrameCount(duration)

        // ───────── Generate Sprite Locally ─────────
        const spriteInfoLocal = await this.generateSprite(
            videoPath,
            tempDir,
            'temp',
            frameCount,
            interval
        )

        const localSpritePath = path.join(tempDir, 'sprite.webp')

        // ───────── Upload Sprite to Cloudinary ─────────
        console.log('☁ Uploading sprite to Cloudinary...')

        const uploadedSprite = await cloudinary.uploader.upload(localSpritePath, {
            resource_type: 'image',
            folder: 'streaming/sprites',
        })

        console.log('✅ Sprite uploaded')

        // ───────── Upload Poster if exists ─────────
        let posterUrl = ''

        if (customThumbnailFile) {
            const posterName = `poster.webp`
            await customThumbnailFile.move(tempDir, { name: posterName })

            const uploadedPoster = await cloudinary.uploader.upload(
                path.join(tempDir, posterName),
                {
                    resource_type: 'image',
                    folder: 'streaming/posters',
                }
            )

            posterUrl = uploadedPoster.secure_url
        }

        // ───────── Cleanup Local Files ─────────
        await fs.rm(tempDir, { recursive: true, force: true })

        // ───────── Build Metadata ─────────
        const thumbnails: ThumbnailMeta[] = Array.from(
            { length: frameCount },
            (_, i) => {
                const timeSecond = Number((i * interval).toFixed(2))
                return {
                    frameNo: i + 1,
                    timeSecond,
                    timeLabel: this.formatTime(timeSecond),
                }
            }
        )

        return {
            videoId: uploadedVideo.public_id,
            fileName: videoFile.clientName,
            videoUrl,
            posterUrl,
            duration,
            durationFormatted: this.formatTime(duration),
            thumbnailCount: frameCount,
            interval,
            intervalLabel:
                interval === 1 ? '1 per second' : `every ${interval.toFixed(2)}s`,
            sprite: {
                path: uploadedSprite.secure_url,
                columns: spriteInfoLocal.columns,
                rows: spriteInfoLocal.rows,
                thumbWidth: spriteInfoLocal.thumbWidth,
                thumbHeight: spriteInfoLocal.thumbHeight,
                spriteWidth: spriteInfoLocal.spriteWidth,
                spriteHeight: spriteInfoLocal.spriteHeight,
            },
            thumbnails,
        }
    }

    // ── Get files for a video ─────────────────────────────────────
    async getVideoFiles(videoId: string): Promise<string[]> {
        const thumbnailDir = app.publicPath(`thumbnails/${videoId}`)
        const files = await fs.readdir(thumbnailDir)
        console.log(`🔍 Found ${files.length} files for video ${videoId}`)
        return files.map((f) => `/thumbnails/${videoId}/${f}`)
    }

    // ── Get all processed videos ──────────────────────────────────
    async getAllVideos(): Promise<{ videoId: string; fileCount: number }[]> {
        const thumbnailDir = app.publicPath('thumbnails')
        const videos = await fs.readdir(thumbnailDir)
        console.log(`📺 Found ${videos.length} processed videos`)

        return Promise.all(
            videos.map(async (videoId) => {
                const files = await fs.readdir(path.join(thumbnailDir, videoId))
                return { videoId, fileCount: files.length }
            })
        )
    }

    // ── Private: Generate sprite sheet via ffmpeg tile filter ──────
    // Single command: fps filter → scale → tile → one image (10x faster than frame-by-frame)
    private generateSprite(
        videoPath: string,
        outputDir: string,
        videoId: string,
        frameCount: number,
        interval: number
    ): Promise<SpriteInfo> {
        return new Promise((resolve, reject) => {
            const thumbWidth = 160
            const thumbHeight = 90
            const columns = 5
            const rows = Math.ceil(frameCount / columns)
            const spritePath = path.join(outputDir, 'sprite.jpg')

            // fps = 1/interval
            // interval=1  → fps=1.0  (1 frame per sec)
            // interval=2  → fps=0.5  (1 frame every 2 sec)
            const fps = 1 / interval

            ffmpeg(videoPath)
                .outputOptions([
                    `-vf fps=${fps},scale=${thumbWidth}:${thumbHeight},tile=${columns}x${rows}`,
                    '-frames:v 1',
                    '-q:v 3',           // quality (1-31, lower = better)
                ])
                .output(spritePath)
                .on('end', async () => {
                    try {
                        console.log('✅ Sprite jpg ready, converting to webp...')

                        // Convert jpg → webp (smaller size)
                        const webpPath = path.join(outputDir, 'sprite.webp')
                        await sharp(spritePath)
                            .webp({ quality: 80 })
                            .toFile(webpPath)

                        // Remove temp jpg
                        await fs.unlink(spritePath).catch(() => { })

                        resolve({
                            path: `/thumbnails/${videoId}/sprite.webp`,
                            columns,
                            rows,
                            thumbWidth,
                            thumbHeight,
                            spriteWidth: thumbWidth * columns,
                            spriteHeight: thumbHeight * rows,
                        })
                    } catch (err) {
                        reject(err)
                    }
                })
                .on('error', (err) => {
                    console.error('❌ Sprite generation error:', err)
                    reject(err)
                })
                .run()
        })
    }

    // ── Private: Get video duration via ffprobe ───────────────────
    private getVideoDuration(videoPath: string): Promise<number> {
        return new Promise((resolve, reject) => {
            ffmpeg.ffprobe(videoPath, (err, metadata) => {
                if (err) return reject(err)
                resolve(metadata.format.duration || 0)
            })
        })
    }

    // ── Private: Calculate frame count based on duration ─────────
    private calculateFrameCount(duration: number): { frameCount: number; interval: number } {
        let frameCount: number
        let interval: number

        if (duration < 60) {
            frameCount = Math.ceil(duration)
            interval = 1
        } else if (duration < 600) {
            frameCount = Math.ceil(duration / 2)
            interval = 2
        } else if (duration < 3600) {
            frameCount = Math.ceil(duration / 5)
            interval = 5
        } else if (duration < 7200) {
            frameCount = Math.ceil(duration / 10)
            interval = 10
        } else {
            frameCount = 500
            interval = duration / 500
        }

        return { frameCount, interval }
    }

    // ── Private: Format seconds → HH:MM:SS or MM:SS ──────────────
    private formatTime(seconds: number): string {
        const hours = Math.floor(seconds / 3600)
        const minutes = Math.floor((seconds % 3600) / 60)
        const secs = Math.floor(seconds % 60)

        if (hours > 0) {
            return `${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`
        }
        return `${minutes.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`
    }
}