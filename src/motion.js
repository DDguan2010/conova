export function springStep(value, velocity, target, delta, stiffness = 250, damping = 30) {
  // Small integration steps keep the spring stable after a delayed frame.
  const steps = Math.max(1, Math.ceil(delta / .008))
  const dt = delta / steps
  for (let i = 0; i < steps; i++) {
    velocity += ((target - value) * stiffness - velocity * damping) * dt
    value += velocity * dt
  }
  if (Math.abs(target - value) < .025 && Math.abs(velocity) < .04) return { value: target, velocity: 0 }
  return { value, velocity }
}

function randomFor(key) {
  let seed = 2166136261
  for (const character of key) seed = Math.imul(seed ^ character.charCodeAt(0), 16777619)
  return () => {
    seed += 0x6D2B79F5
    let value = seed
    value = Math.imul(value ^ value >>> 15, value | 1)
    value ^= value + Math.imul(value ^ value >>> 7, value | 61)
    return ((value ^ value >>> 14) >>> 0) / 4294967296
  }
}

export function scatterPosition(tile, width, height, size) {
  const random = randomFor(tile.key)
  const compact = width < 650
  let nx = tile.x * size / (width / 2), ny = tile.y * size / (height / 2)
  nx += (random() - .5) * .65
  ny += (random() - .5) * .65
  if (!tile.x && !tile.y) { nx = random() - .5; ny = random() - .5 }
  const alongJitter = (random() - .5) * size * 1.25
  const depth = random()
  if (Math.abs(nx) > Math.abs(ny)) {
    const x = Math.sign(nx || 1) * (width / 2 + size * (compact ? .16 + depth * .27 : -.13 + depth * .52))
    const y = Math.max(-height / 2 - size * .1, Math.min(height / 2 + size * .1, tile.y * size + alongJitter))
    return { x, y }
  }
  const y = Math.sign(ny || 1) * (height / 2 + size * (.08 + depth * .33))
  const x = Math.max(-width / 2 - size * .1, Math.min(width / 2 + size * .1, tile.x * size + alongJitter))
  return { x, y }
}
