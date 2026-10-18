import React, { useCallback, useEffect, useRef, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { api, canAccountLogin, accountLogin as loginWithAccount, native, updateNativeMedia, listenNativeMedia } from './api'
import { demoLibrary } from './demo'
import { usePlayer } from './usePlayer'
import { MusicCanvas } from './MusicCanvas'
import './styles.css'

const saved = (key, fallback) => { try { return JSON.parse(localStorage.getItem(key)) ?? fallback } catch { return fallback } }

function App() {
  const [library, setLibrary] = useState([]), [demo, setDemo] = useState(false), [user, setUser] = useState(null), [ready, setReady] = useState(false)
  const [view, setView] = useState('welcome'), [selection, setSelection] = useState(() => saved('conova.selection', { collectionId: null, trackId: null }))
  const [mode, setMode] = useState(() => saved('conova.mode', 'sequence')), [sources, setSources] = useState({ owned: [], followed: [] }), [sourceTab, setSourceTab] = useState('owned')
  const [sourceLoading, setSourceLoading] = useState(false), [busy, setBusy] = useState(''), [message, setMessage] = useState('')
  const [qr, setQr] = useState(null), [qrStatus, setQrStatus] = useState('waiting')
  const [autoSync, setAutoSync] = useState(() => saved('conova.autosync', true)), [sceneSize, setSceneSize] = useState({ width: 1400, height: 590 })
  const scene = useRef(null), gesture = useRef(null), holdTimer = useRef(null), suppressClick = useRef(false), rowPositions = useRef({}), history = useRef([]), syncLock = useRef(false), alive = useRef(true), state = useRef({})
  const collectionIndex = Math.max(0, library.findIndex((item) => item.id === selection.collectionId)), collection = library[collectionIndex]
  const trackIndex = Math.max(0, collection?.tracks.findIndex((item) => item.id === selection.trackId) ?? 0), track = collection?.tracks[trackIndex]
  const scattered = view !== null || mode === 'single'
  const player = usePlayer({ onEnd: () => state.current.advance(1, { ended: true, autoplay: true }), onError: (error) => { setMessage(error); setView('error') } })
  state.current = { library, selection, collection, collectionIndex, trackIndex, track, player, view, mode, demo }

  const openView = (next) => { setMessage(''); setView(next) }
  const bootstrap = useCallback(async () => {
    setMessage('')
    if (new URLSearchParams(location.search).has('demo')) {
      setDemo(true); setLibrary(demoLibrary); setSelection({ collectionId: demoLibrary[0].id, trackId: demoLibrary[0].tracks[3].id }); setView(null); setReady(true)
      return
    }
    try {
      const session = await api('/session')
      if (!alive.current) return
      setUser(session.user); setLibrary(session.library); setView(session.library.length ? null : session.user ? 'manage' : 'welcome')
    } catch (error) { if (alive.current) { setMessage(error.message); setView('welcome') } }
    finally { if (alive.current) setReady(true) }
  }, [])
  useEffect(() => { alive.current = true; bootstrap(); return () => { alive.current = false; clearTimeout(holdTimer.current) } }, [bootstrap])
  useEffect(() => { localStorage.setItem('conova.selection', JSON.stringify(selection)) }, [selection])
  useEffect(() => { localStorage.setItem('conova.mode', JSON.stringify(mode)) }, [mode])
  useEffect(() => { localStorage.setItem('conova.autosync', JSON.stringify(autoSync)) }, [autoSync])
  useEffect(() => {
    const observer = new ResizeObserver(([entry]) => setSceneSize({ width: entry.contentRect.width, height: entry.contentRect.height }))
    observer.observe(scene.current)
    return () => observer.disconnect()
  }, [])

  const select = useCallback((row, column, autoplay = true, addHistory = true) => {
    const item = state.current.library[row], song = item?.tracks[column]
    if (!item) return
    if (song?.unavailable) { setMessage('这个视频已经失效，选择其他封面继续听。'); setView('error'); return }
    if (addHistory && state.current.track) {
      history.current.push({ collectionId: state.current.collection.id, trackId: state.current.track.id })
      if (history.current.length > 100) history.current.shift()
    }
    rowPositions.current[item.id] = column
    setSelection({ collectionId: item.id, trackId: song?.id || null }); setView(null); setMessage('')
    if (song) player.load(song, autoplay); else player.stop()
  }, [player.load, player.stop])
  const advance = useCallback((direction, { ended = false, autoplay } = {}) => {
    const current = state.current, songs = current.collection?.tracks || []
    if (!songs.length) return
    if (direction < 0 && current.mode === 'shuffle') {
      let last
      while ((last = history.current.pop())) {
        const row = current.library.findIndex((item) => item.id === last.collectionId), column = current.library[row]?.tracks.findIndex((item) => item.id === last.trackId)
        if (row >= 0 && column >= 0) { select(row, column, autoplay ?? (current.player.playing || current.player.loading), false); return }
      }
    }
    let index = current.trackIndex
    if (current.mode !== 'single' || !ended) {
      if (current.mode === 'shuffle' && songs.length > 1) index = (index + 1 + Math.floor(Math.random() * (songs.length - 1))) % songs.length
      else index = (index + direction + songs.length) % songs.length
    }
    for (let count = 0; count < songs.length && songs[index]?.unavailable; count++) index = (index + direction + songs.length) % songs.length
    select(current.collectionIndex, index, autoplay ?? (current.player.playing || current.player.loading))
  }, [select])
  state.current.advance = advance
  const changeCollection = useCallback((direction) => {
    const current = state.current
    if (!current.library.length) return
    const row = (current.collectionIndex + direction + current.library.length) % current.library.length
    select(row, Math.min(rowPositions.current[current.library[row].id] || 0, Math.max(0, current.library[row].tracks.length - 1)), current.player.playing || current.player.loading)
  }, [select])
  useEffect(() => {
    const handler = (event) => {
      if (event.target.closest('input, textarea, a, select')) return
      if (event.key === ' ' && event.target.closest('button')) return
      if (event.key === 'Escape') { if (state.current.library.length) setView(null); return }
      if (state.current.view) return
      if (['ArrowRight', 'ArrowLeft', 'ArrowDown', 'ArrowUp', ' '].includes(event.key)) event.preventDefault()
      if (event.key === 'ArrowRight') advance(1)
      if (event.key === 'ArrowLeft') advance(-1)
      if (event.key === 'ArrowDown') changeCollection(1)
      if (event.key === 'ArrowUp') changeCollection(-1)
      if (event.key === ' ' && !event.target.closest('button')) state.current.player.toggle(state.current.track)
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [advance, changeCollection])
  useEffect(() => {
    if (!('mediaSession' in navigator)) return
    const actions = { play: () => { if (!state.current.player.playing) state.current.player.toggle(state.current.track) }, pause: () => { if (state.current.player.playing) state.current.player.toggle(state.current.track) }, nexttrack: () => advance(1), previoustrack: () => advance(-1), seekto: (details) => state.current.player.seek(details.seekTime) }
    for (const [action, callback] of Object.entries(actions)) { try { navigator.mediaSession.setActionHandler(action, callback) } catch { /* Unsupported platform action. */ } }
    return () => { for (const action of Object.keys(actions)) { try { navigator.mediaSession.setActionHandler(action, null) } catch { /* Unsupported platform action. */ } } }
  }, [advance])
  useEffect(() => { if ('mediaSession' in navigator) navigator.mediaSession.playbackState = player.playing ? 'playing' : 'paused' }, [player.playing])
  useEffect(() => {
    if (!native || !track || (!player.playing && !player.duration)) return
    updateNativeMedia({ title: track.title, artist: track.artist || '', duration: player.duration || track.duration || 0, position: player.position, playing: player.playing }).catch(() => {})
  }, [track?.id, track?.title, track?.artist, track?.duration, player.duration, player.playing])
  useEffect(() => {
    if (!native) return
    let listener, disposed = false
    listenNativeMedia((value) => {
      const action = value?.action
      if (action === 'play' && !state.current.player.playing) state.current.player.toggle(state.current.track)
      else if (action === 'pause' && state.current.player.playing) state.current.player.toggle(state.current.track)
      else if (action === 'nexttrack') state.current.advance(1, { autoplay: true })
      else if (action === 'previoustrack') state.current.advance(-1, { autoplay: true })
      else if (action === 'seekto') state.current.player.seek(Number(value.seekTime))
      else if (action === 'stop') state.current.player.stop()
    }).then((handle) => { if (disposed) handle?.remove?.(); else listener = handle })
    return () => { disposed = true; listener?.remove?.() }
  }, [native, advance])

  const sync = useCallback(async (silent = false) => {
    if (syncLock.current || state.current.demo || !state.current.library.length) return
    syncLock.current = true; setBusy('sync')
    try {
      const result = await api('/library/sync', { method: 'POST' })
      if (!alive.current) return
      setLibrary(result.library)
      const errors = result.results.filter((item) => !item.ok)
      if (errors.length && !silent) { setMessage(errors.map((item) => item.error).join('；')); setView('error') }
      else if (!silent) setMessage('所有专辑已同步。')
    } catch (error) { if (!silent && alive.current) setMessage(error.message) }
    finally { syncLock.current = false; if (alive.current) setBusy('') }
  }, [])
  useEffect(() => {
    if (!user || demo || !autoSync || !library.length) return
    const interval = setInterval(() => { if (document.visibilityState === 'visible') sync(true) }, 5 * 60000)
    const resume = () => {
      const oldest = Math.min(...state.current.library.map((item) => item.syncedAt || 0))
      if (document.visibilityState === 'visible' && Date.now() - oldest > 5 * 60000) sync(true)
    }
    document.addEventListener('visibilitychange', resume); resume()
    return () => { clearInterval(interval); document.removeEventListener('visibilitychange', resume) }
  }, [user, demo, autoSync, library.length, sync])
  const loadSources = useCallback(async () => {
    setSourceLoading(true)
    try { setSources(await api('/sources')) } catch (error) { setMessage(error.message) }
    finally { setSourceLoading(false) }
  }, [])
  useEffect(() => { if (view === 'manage' && user && !demo) loadSources() }, [view, user, demo, loadSources])
  const generateQr = async () => {
    setView('login'); setMessage(''); setQr(null); setQrStatus('waiting'); setBusy('qr')
    try { setQr(await api('/auth/qr', { method: 'POST' })) } catch (error) { setMessage(error.message) }
    finally { setBusy('') }
  }
  const qrExpired = qrStatus === 'expired'
  useEffect(() => {
    if (view !== 'login' || !qr || qrExpired) return
    let cancelled = false, timer
    const poll = async () => {
      try {
        const result = await api('/auth/qr/status')
        if (cancelled) return
        if (result.status === 'success') {
          player.stop(); setDemo(false); setUser(result.user)
          const session = await api('/session')
          if (cancelled) return
          setLibrary(session.library); setMessage(''); setView('manage'); return
        }
        setQrStatus(result.status)
        if (result.status === 'expired') return
      } catch (error) { if (!cancelled) setMessage(error.message) }
      if (!cancelled) timer = setTimeout(poll, 2500)
    }
    timer = setTimeout(poll, 2500)
    return () => { cancelled = true; clearTimeout(timer) }
  }, [qr, view, qrExpired, player.stop])
  const accountLogin = async () => {
    if (!canAccountLogin) return generateQr()
    setView('login'); setMessage(''); setBusy('account')
    try {
      const result = await loginWithAccount()
      if (result.cancelled) { setMessage('登录已取消，可继续扫码登录。'); return }
      await bootstrap(); setDemo(false); player.stop(); setView('manage')
    } catch (error) { setMessage(error.message) }
    finally { setBusy('') }
  }
  const toggleSource = async (source) => {
    if (busy || syncLock.current) return
    setBusy(source.id); setMessage('')
    try {
      if (library.some((item) => item.id === source.id)) {
        await api(`/library/${encodeURIComponent(source.id)}`, { method: 'DELETE' })
        const next = library.filter((item) => item.id !== source.id); setLibrary(next)
        if (collection?.id === source.id) { player.stop(); setSelection({ collectionId: next[0]?.id || null, trackId: next[0]?.tracks[0]?.id || null }) }
      } else {
        const result = await api('/library', { method: 'POST', body: source })
        setLibrary((items) => [...items.filter((item) => item.id !== result.id), result])
        if (!library.length) setSelection({ collectionId: result.id, trackId: result.tracks[0]?.id || null })
      }
    } catch (error) { setMessage(error.message) }
    finally { setBusy('') }
  }
  function startDemo() { player.stop(); setDemo(true); setLibrary(demoLibrary); setSelection({ collectionId: demoLibrary[0].id, trackId: demoLibrary[0].tracks[2].id }); setView(null); setMessage('') }
  async function logout() {
    setBusy('logout')
    try {
      if (user && !demo) await api('/auth/logout', { method: 'POST' })
      if (!demo) await window.conova?.clearLogin?.()
      player.stop(); setDemo(false); setQr(null); setMessage('')
      if (user && demo) await bootstrap()
      else { setLibrary([]); setUser(null); setView('welcome') }
    } catch (error) { setMessage(error.message) }
    finally { setBusy('') }
  }
  function beginGesture(event, tile) {
    if (event.button !== 0 || view) return
    event.currentTarget.setPointerCapture(event.pointerId)
    gesture.current = { x: event.clientX, y: event.clientY, axis: null }; suppressClick.current = false
    clearTimeout(holdTimer.current)
    holdTimer.current = setTimeout(() => { suppressClick.current = true; gesture.current = null; setMessage(''); setView('controls') }, 560)
  }
  function moveGesture(event) {
    const start = gesture.current
    if (!start || view) return
    const dx = event.clientX - start.x, dy = event.clientY - start.y
    if (Math.hypot(dx, dy) <= 9) return
    clearTimeout(holdTimer.current)
    if (!start.axis) start.axis = Math.abs(dx) > Math.abs(dy) ? 'x' : 'y'
    scene.current.dataset.dragging = 'true'
    scene.current.style.setProperty('--drag-x', `${start.axis === 'x' ? dx * .65 : 0}px`)
    scene.current.style.setProperty('--drag-y', `${start.axis === 'y' ? dy * .65 : 0}px`)
  }
  function endGesture(event) {
    clearTimeout(holdTimer.current)
    scene.current.removeAttribute('data-dragging')
    scene.current.style.setProperty('--drag-x', '0px')
    scene.current.style.setProperty('--drag-y', '0px')
    const start = gesture.current; gesture.current = null
    if (!start || view) return
    const dx = event.clientX - start.x, dy = event.clientY - start.y
    if (Math.max(Math.abs(dx), Math.abs(dy)) < 40) return
    suppressClick.current = true
    if (Math.abs(dx) > Math.abs(dy) * 1.15) advance(dx < 0 ? 1 : -1); else changeCollection(dy < 0 ? 1 : -1)
  }

  const compact = sceneSize.width < 650, tileSize = compact ? Math.max(150, sceneSize.width / 2.25) : Math.max(185, Math.min(320, Math.max(sceneSize.width / 4.8, sceneSize.height / 3.2))), step = tileSize
  const tiles = []
  if (library.length) {
    for (const { item, index: row, offset: y } of library.map((item, index) => { let offset = index - collectionIndex; if (offset > library.length / 2) offset -= library.length; if (offset < -library.length / 2) offset += library.length; return { item, index, offset } }).filter((row) => Math.abs(row.offset) <= 2)) {
      const center = row === collectionIndex ? trackIndex : Math.min(rowPositions.current[item.id] || trackIndex, Math.max(0, item.tracks.length - 1))
      for (let column = Math.max(0, center - 5); column < Math.min(item.tracks.length, center + 6); column++) tiles.push({ key: `${item.id}:${item.tracks[column].id}`, track: item.tracks[column], x: column - center, y, row, column, active: row === collectionIndex && column === trackIndex })
    }
  } else { for (let y = -2; y <= 2; y++) for (let x = -5; x <= 5; x++) tiles.push({ key: `placeholder:${x}:${y}`, x, y, placeholder: true }) }
  const vm = { view, openView, setView, library, collection, collectionIndex, track, user, demo, ready, busy, message, setMessage, mode, setMode, qr, qrStatus, generateQr, accountLogin, startDemo, logout, sources, sourceTab, setSourceTab, sourceLoading, loadSources, toggleSource, autoSync, setAutoSync, sync, select, player, rowPositions, advance, bootstrap }

  return <MusicCanvas {...{ player, view, mode, tiles, tileSize, step, sceneSize, scattered, scene, vm, beginGesture, moveGesture, endGesture, suppressClick, holdTimer, gesture, select, track, openView }} />
}
createRoot(document.getElementById('root')).render(<App />)
