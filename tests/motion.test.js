import { test } from 'node:test'
import assert from 'node:assert/strict'
import { scatterPosition, springStep } from '../src/motion.js'

test('a running spring can reverse direction without resetting its position or becoming unstable', () => {
  let position = 0, velocity = 0
  for (let frame = 0; frame < 6; frame++) {
    const next = springStep(position, velocity, 600, 1 / 60)
    position = next.value; velocity = next.velocity
  }
  const interruptedAt = position
  for (let frame = 0; frame < 180; frame++) {
    const next = springStep(position, velocity, -200, 1 / 60)
    if (frame === 0) assert.ok(Math.abs(next.value - interruptedAt) < 50, 'retargeting must continue from the in-flight position')
    assert.ok(Number.isFinite(next.value)); assert.ok(Number.isFinite(next.velocity))
    position = next.value; velocity = next.velocity
  }
  assert.equal(position, -200); assert.equal(velocity, 0)
})
test('scatter stays deterministic, breaks grid alignment and keeps the central text area clear', () => {
  for (const [width, height, size] of [[1280, 720, 267], [390, 844, 173]]) {
    const positions = []
    for (let y = -2; y <= 2; y++) for (let x = -4; x <= 4; x++) {
      const tile = { key: `${x}:${y}`, x, y }
      const position = scatterPosition(tile, width, height, size)
      assert.deepEqual(position, scatterPosition(tile, width, height, size))
      const halfTextWidth = width < 650 ? 120 : 280
      const inText = Math.abs(position.x) - size / 2 < halfTextWidth && Math.abs(position.y) - size / 2 < 210
      assert.equal(inText, false)
      positions.push(position)
    }
    assert.ok(new Set(positions.map((item) => item.x.toFixed(2))).size > 20)
    assert.ok(new Set(positions.map((item) => item.y.toFixed(2))).size > 20)
  }
})
