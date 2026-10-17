import { useEffect, useLayoutEffect, useRef } from 'react'
import { springStep } from './motion'

export function useTileMotion(targets, scene) {
  const nodes = useRef(new Map())
  const motion = useRef(new Map())

  useLayoutEffect(() => {
    const live = new Set()
    for (const target of targets) {
      live.add(target.key)
      let item = motion.current.get(target.key)
      if (!item) {
        item = { x: target.x, y: target.y, scale: target.scale, vx: 0, vy: 0, vs: 0, target }
        motion.current.set(target.key, item)
        const node = nodes.current.get(target.key)
        if (node) node.style.transform = transform(item)
      }
      item.target = target
    }
    for (const key of motion.current.keys()) if (!live.has(key)) motion.current.delete(key)
  }, [targets])

  useEffect(() => {
    let frame, previous = performance.now()
    const reduced = matchMedia('(prefers-reduced-motion: reduce)')
    const tick = (now) => {
      const dt = Math.min(.04, Math.max(.001, (now - previous) / 1000))
      previous = now
      const dragX = parseFloat(scene.current?.style.getPropertyValue('--drag-x')) || 0
      const dragY = parseFloat(scene.current?.style.getPropertyValue('--drag-y')) || 0
      const dragging = scene.current?.dataset.dragging === 'true'
      for (const [key, item] of motion.current) {
        const node = nodes.current.get(key)
        if (!node) continue
        const x = item.target.x + dragX, y = item.target.y + dragY
        if (reduced.matches) { item.x = x; item.y = y; item.scale = item.target.scale; item.vx = 0; item.vy = 0; item.vs = 0 }
        else {
          const nextX = springStep(item.x, item.vx, x, dt, dragging ? 550 : 250, dragging ? 42 : 30)
          const nextY = springStep(item.y, item.vy, y, dt, dragging ? 550 : 250, dragging ? 42 : 30)
          const nextScale = springStep(item.scale, item.vs, item.target.scale, dt)
          item.x = nextX.value; item.vx = nextX.velocity
          item.y = nextY.value; item.vy = nextY.velocity
          item.scale = nextScale.value; item.vs = nextScale.velocity
        }
        const value = transform(item)
        if (node.style.transform !== value) node.style.transform = value
      }
      frame = requestAnimationFrame(tick)
    }
    frame = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(frame)
  }, [scene])

  return (key) => (node) => { if (node) nodes.current.set(key, node); else nodes.current.delete(key) }
}

const transform = (item) => `translate3d(calc(-50% + ${item.x.toFixed(3)}px), calc(-50% + ${item.y.toFixed(3)}px), 0) scale(${item.scale.toFixed(5)})`
