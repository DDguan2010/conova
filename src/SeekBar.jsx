import { useRef, useState } from 'react'

export function SeekBar({ player, fallbackDuration }) {
  const dragging = useRef(false)
  const [preview, setPreview] = useState(null)
  const duration = player.duration || fallbackDuration || 1
  const position = preview ?? player.position
  const finish = (event) => {
    if (!dragging.current) return
    dragging.current = false
    player.seek(Number(event.currentTarget.value))
    setPreview(null)
  }
  const cancel = () => { dragging.current = false; setPreview(null) }
  return <>
    <div className="progress-track" style={{ '--progress': `${Math.max(0, Math.min(100, position / duration * 100))}%` }}><span className="progress-fill" /></div>
    <input className="cover-progress" type="range" aria-label="播放进度" min="0" max={duration} step="0.1" value={position}
      onPointerDown={(event) => {
        dragging.current = true
        setPreview(player.position)
        event.currentTarget.setPointerCapture(event.pointerId)
      }}
      onChange={(event) => {
        const value = Number(event.currentTarget.value)
        if (dragging.current) setPreview(value)
        else player.seek(value)
      }}
      onPointerUp={finish} onPointerCancel={cancel} onLostPointerCapture={cancel} />
  </>
}
