import { useEffect, useRef } from 'react'

export function Waveform({ player, cover }) {
  const canvas = useRef(null)
  const texture = useRef(null)

  useEffect(() => {
    let cancelled = false
    texture.current = null
    const image = new Image()
    image.crossOrigin = 'anonymous'
    image.src = cover
    image.decode().then(() => {
      if (cancelled) return
      const blurred = document.createElement('canvas')
      blurred.width = 160; blurred.height = 80
      const context = blurred.getContext('2d')
      context.filter = 'blur(10px)'
      context.drawImage(image, -25, -25, 210, 130)
      texture.current = blurred
    }).catch(() => { /* Use monochrome bars while an unavailable cover is loading. */ })
    return () => { cancelled = true }
  }, [cover])

  useEffect(() => {
    let frame
    const samples = new Uint8Array(1024)
    const heights = new Float32Array(38)
    let previous = performance.now()
    const draw = (now) => {
      const element = canvas.current
      if (!element) return
      const context = element.getContext('2d'), width = element.clientWidth, height = element.clientHeight, ratio = window.devicePixelRatio || 1
      if (element.width !== Math.round(width * ratio) || element.height !== Math.round(height * ratio)) { element.width = Math.round(width * ratio); element.height = Math.round(height * ratio) }
      context.setTransform(ratio, 0, 0, ratio, 0, 0)
      context.clearRect(0, 0, width, height)
      const analyser = player.graph.current?.analyser
      if (player.playing && analyser) analyser.getByteTimeDomainData(samples)
      const alpha = 1 - Math.exp(-Math.min(80, now - previous) / 55)
      previous = now
      const gap = 3, bars = heights.length, barWidth = Math.max(1, (width - (bars - 1) * gap) / bars), segment = Math.floor(samples.length / bars)
      context.save()
      context.beginPath()
      for (let index = 0; index < bars; index++) {
        let energy = 0
        if (player.playing && analyser) for (let i = index * segment; i < (index + 1) * segment; i++) energy += ((samples[i] - 128) / 128) ** 2
        const amplitude = Math.min(1, Math.sqrt(energy / segment) * 7)
        heights[index] += (Math.max(2, amplitude * height) - heights[index]) * alpha
        const h = Math.max(2, heights[index])
        context.rect(index * (barWidth + gap), height - h, barWidth, h)
      }
      context.clip()
      if (texture.current) context.drawImage(texture.current, 0, 0, width, height)
      else { context.fillStyle = '#bcbcbc'; context.fillRect(0, 0, width, height) }
      context.restore()
      frame = requestAnimationFrame(draw)
    }
    frame = requestAnimationFrame(draw)
    return () => cancelAnimationFrame(frame)
  }, [player.playing, player.graph])

  return <canvas ref={canvas} className="waveform" aria-label="实时音频波形" />
}
