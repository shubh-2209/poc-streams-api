  export default class FFmpegFilterBuilder {
    build(filters: any): string[] {
      if (!filters) return []
    
      const result = []
      const eq = []
    
      if (filters.brightness) eq.push(`brightness=${(filters.brightness - 100) / 100}`)
      if (filters.contrast) eq.push(`contrast=${filters.contrast / 100}`)
      if (filters.saturation) eq.push(`saturation=${filters.saturation / 100}`)
      
      if (eq.length) result.push(`eq=${eq.join(':')}`)
      if (filters.hue) result.push(`hue=h=${filters.hue}`)
      if (filters.blur) result.push(`boxblur=${filters.blur}`)
      
      return result
    }
  }
