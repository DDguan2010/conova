import { mkdir, writeFile } from 'node:fs/promises'

// Original 60-second ambient study: soft A minor / F major pads and quiet bell tones.
// Deterministic synthesis, without external recordings or licensed musical works.
const sampleRate = 22050, seconds = 60, samples = sampleRate * seconds
const pcm = Buffer.alloc(samples * 2)
const chords = [[110,164.8138,220,261.6256],[87.3071,130.8128,174.6141,220],[130.8128,195.9977,261.6256,329.6276],[97.9989,146.8324,195.9977,246.9417]]
let seed = 321, filteredNoise = 0
for (let index = 0; index < samples; index++) {
  const t = index / sampleRate
  const segment = Math.floor(t / 7.5), phase = t % 7.5
  const chord = chords[segment % chords.length]
  const envelope = Math.min(1, phase / 2.8, (7.5 - phase) / 2.8)
  let value = 0
  for (let voice = 0; voice < chord.length; voice++) {
    const frequency = chord[voice]
    value += Math.sin(2 * Math.PI * frequency * t + .1 * Math.sin(t * .23)) * .038
    value += Math.sin(2 * Math.PI * frequency * 1.002 * t) * .026
    value += Math.sin(2 * Math.PI * frequency * 2 * t) * .006
  }
  value *= Math.max(0, envelope)
  const bellTime = t % 3.75
  const bellFrequency = [523.2511,659.2551,783.9909,880][Math.floor(t / 3.75) % 4]
  value += (Math.sin(2 * Math.PI * bellFrequency * bellTime) + .25 * Math.sin(2 * Math.PI * bellFrequency * 2 * bellTime)) * Math.exp(-bellTime * 1.8) * .018 * Math.min(1, bellTime * 40)
  seed = (seed * 1664525 + 1013904223) >>> 0
  filteredNoise = filteredNoise * .97 + (seed / 4294967296 - .5) * .03
  value += filteredNoise * .012
  value *= Math.min(1, t / 3, (seconds - t) / 4)
  pcm.writeInt16LE(Math.round(Math.max(-1, Math.min(1, value)) * 32767), index * 2)
}
const header = Buffer.alloc(44)
header.write('RIFF'); header.writeUInt32LE(36 + pcm.length, 4); header.write('WAVE', 8); header.write('fmt ', 12); header.writeUInt32LE(16, 16); header.writeUInt16LE(1, 20); header.writeUInt16LE(1, 22); header.writeUInt32LE(sampleRate, 24); header.writeUInt32LE(sampleRate * 2, 28); header.writeUInt16LE(2, 32); header.writeUInt16LE(16, 34); header.write('data', 36); header.writeUInt32LE(pcm.length, 40)
await mkdir('public/audio', { recursive: true })
await writeFile('public/audio/ambient.wav', Buffer.concat([header, pcm]))
console.log('Original ambient sample written: public/audio/ambient.wav')
