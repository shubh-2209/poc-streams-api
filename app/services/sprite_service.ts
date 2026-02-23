  import ffmpeg from 'fluent-ffmpeg'

  export default class SpriteService {
    generate(videoPath:any, spritePath:any, duration:any) {
      return new Promise((resolve, reject) => {
        const interval = duration < 600 ? 2 : 5
        const fps = 1 / interval

        const frameCount = Math.floor(duration / interval)
        const columns = 5
        const rows = Math.ceil(frameCount / columns)

        ffmpeg(videoPath)
          .outputOptions([
            `-vf fps=${fps},scale=160:90,tile=${columns}x${rows}`,
            '-frames:v 1',
            '-vcodec libwebp',
            '-lossless 0',
            '-compression_level 6'
          ])
          .on('end', () =>
            resolve({
              columns,
              rows,
              thumbWidth: 160,
              thumbHeight: 90
            })
          )
          .on('error', reject)
          .save(spritePath)
      })
    }
  }