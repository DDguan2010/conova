import { useCallback, useEffect, useRef, useState } from 'react'
import { api, coverUrl, mediaUrl } from './api'

export function usePlayer({ onEnd, onError }) {
  const audio = useRef(null), graph = useRef(null), generation = useRef(0), current = useRef(null), desired = useRef(false)
  const [playing, setPlaying] = useState(false), [loading, setLoading] = useState(false), [position, setPosition] = useState(0), [duration, setDuration] = useState(0)
  const [volume, setVolumeState] = useState(() => Number(localStorage.getItem('conova.volume') ?? 0.7))
  const callbacks = useRef({ onEnd, onError }); callbacks.current = { onEnd, onError }
  useEffect(() => {
    const element = new Audio()
    element.crossOrigin = 'anonymous'; element.preload = 'metadata'; element.volume = Math.max(0, Math.min(1, volume)); audio.current = element
    const events = {
      timeupdate: () => setPosition(element.currentTime), durationchange: () => setDuration(Number.isFinite(element.duration) ? element.duration : 0),
      playing: () => { setPlaying(true); setLoading(false) }, pause: () => setPlaying(false),
      ended: () => { desired.current = false; setPlaying(false); callbacks.current.onEnd?.() },
      error: () => { setPlaying(false); setLoading(false); desired.current = false; current.current = null; callbacks.current.onError?.('这首音频暂时无法播放，请重试或切换下一首。') },
    }
    for (const [name, listener] of Object.entries(events)) element.addEventListener(name, listener)
    return () => { generation.current++; for (const [name, listener] of Object.entries(events)) element.removeEventListener(name, listener); element.pause(); element.removeAttribute('src'); element.load(); audio.current = null; graph.current?.context.close(); graph.current = null }
  }, [])
  const ensureGraph = useCallback(async () => {
    if (!audio.current) return
    if (!graph.current) {
      const context = new AudioContext(), source = context.createMediaElementSource(audio.current), analyser = context.createAnalyser()
      analyser.fftSize = 1024; analyser.smoothingTimeConstant = 0.82; source.connect(analyser); analyser.connect(context.destination); graph.current = { context, analyser }
    }
    if (graph.current.context.state === 'suspended') await graph.current.context.resume()
  }, [])
  const load = useCallback(async (track, autoplay = true) => {
    if (!audio.current || !track) return
    if (track.unavailable) { callbacks.current.onError?.('这个视频已失效，试试其他歌曲。'); return }
    const id = ++generation.current, element = audio.current
    desired.current = autoplay; element.pause(); setPlaying(false); setPosition(0); setDuration(track.duration || 0); setLoading(autoplay); current.current = null
    try {
      if (autoplay) await ensureGraph()
      const result = track.demo ? { url: '/audio/ambient.wav', duration: 60 } : await api(`/track/${track.bvid}`)
      if (generation.current !== id) return
      element.src = mediaUrl(result.url); current.current = track.id
      if (desired.current) await element.play(); else setLoading(false)
      if ('mediaSession' in navigator) navigator.mediaSession.metadata = new MediaMetadata({ title: track.title, artist: track.artist, album: 'conova', artwork: track.cover ? [{ src: new URL(coverUrl(track.cover), location.href).href, sizes: '512x512', type: 'image/jpeg' }] : [] })
    } catch (error) {
      if (generation.current !== id) return
      setLoading(false); setPlaying(false)
      if (error.name !== 'AbortError') callbacks.current.onError?.(error.name === 'NotAllowedError' ? '点击封面即可开始播放。' : error.message)
    }
  }, [ensureGraph])
  const toggle = useCallback(async (track) => {
    const element = audio.current
    if (!track || !element) return
    if (loading && !current.current) { desired.current = !desired.current; setLoading(desired.current); return }
    if (current.current !== track.id) return load(track, true)
    if (!element.paused) { desired.current = false; element.pause(); return }
    try { desired.current = true; await ensureGraph(); await element.play() } catch (error) { callbacks.current.onError?.(error.message) }
  }, [loading, load, ensureGraph])
  const stop = useCallback(() => {
    generation.current++; desired.current = false; current.current = null; audio.current?.pause()
    if (audio.current) { audio.current.removeAttribute('src'); audio.current.load() }
    setPosition(0); setDuration(0); setLoading(false); setPlaying(false)
  }, [])
  const seek = useCallback((value) => { if (audio.current && Number.isFinite(audio.current.duration)) { audio.current.currentTime = Math.max(0, Math.min(value, audio.current.duration)); setPosition(audio.current.currentTime) } }, [])
  const setVolume = (value) => { setVolumeState(value); if (audio.current) audio.current.volume = value; localStorage.setItem('conova.volume', String(value)) }
  return { playing, loading, position, duration, volume, setVolume, load, toggle, stop, seek, audio, graph }
}
