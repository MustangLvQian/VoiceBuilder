// Tests for web/audio-format.js - the WAV encoder the recording page uses.
// Run with: npm test
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  TARGET_SAMPLE_RATE, floatToInt16, downmix, encodeWav, peakAmplitude, durationSeconds,
} from '../web/audio-format.js'

function ascii(view, offset, length) {
  let text = ''
  for (let i = 0; i < length; i++) text += String.fromCharCode(view.getUint8(offset + i))
  return text
}

test('floatToInt16 clamps instead of wrapping', () => {
  const out = floatToInt16(Float32Array.from([0, 1, -1, 2, -2, 0.5]))
  assert.equal(out[0], 0)
  assert.equal(out[1], 32767)
  assert.equal(out[2], -32768)
  assert.equal(out[3], 32767, 'above +1 clamps to max, does not wrap to negative')
  assert.equal(out[4], -32768, 'below -1 clamps to min, does not wrap to positive')
  assert.equal(out[5], 16384)
})

test('floatToInt16 treats NaN as silence', () => {
  const out = floatToInt16(Float32Array.from([NaN, Infinity, -Infinity]))
  assert.deepEqual(Array.from(out), [0, 32767, -32768])
})

test('downmix averages channels', () => {
  const left = Float32Array.from([1, 0, 1])
  const right = Float32Array.from([0, 1, 0])
  assert.deepEqual(Array.from(downmix([left, right])), [0.5, 0.5, 0.5])
})

test('downmix passes a single channel through untouched', () => {
  const mono = Float32Array.from([0.1, 0.2])
  assert.equal(downmix([mono]), mono)
})

test('encodeWav writes a canonical 16-bit mono header', () => {
  const buffer = encodeWav(Int16Array.from([0, 1, -1]), TARGET_SAMPLE_RATE)
  const view = new DataView(buffer)
  assert.equal(buffer.byteLength, 44 + 6, 'header + 3 samples * 2 bytes')
  assert.equal(ascii(view, 0, 4), 'RIFF')
  assert.equal(view.getUint32(4, true), 36 + 6)
  assert.equal(ascii(view, 8, 4), 'WAVE')
  assert.equal(ascii(view, 12, 4), 'fmt ')
  assert.equal(view.getUint32(16, true), 16)
  assert.equal(view.getUint16(20, true), 1, 'PCM')
  assert.equal(view.getUint16(22, true), 1, 'mono')
  assert.equal(view.getUint32(24, true), TARGET_SAMPLE_RATE)
  assert.equal(view.getUint32(28, true), TARGET_SAMPLE_RATE * 2)
  assert.equal(view.getUint16(32, true), 2)
  assert.equal(view.getUint16(34, true), 16)
  assert.equal(ascii(view, 36, 4), 'data')
  assert.equal(view.getUint32(40, true), 6)
  assert.equal(view.getInt16(44, true), 0)
  assert.equal(view.getInt16(46, true), 1)
  assert.equal(view.getInt16(48, true), -1)
})

test('encoded bytes are little-endian samples', () => {
  const buffer = encodeWav(Int16Array.from([258]), TARGET_SAMPLE_RATE)
  const bytes = new Uint8Array(buffer, 44)
  assert.equal(bytes[0], 2, 'low byte first')
  assert.equal(bytes[1], 1)
})

test('peakAmplitude finds the loudest sample', () => {
  assert.ok(Math.abs(peakAmplitude(Float32Array.from([0.1, -0.7, 0.3])) - 0.7) < 1e-6)
  assert.equal(peakAmplitude(Float32Array.from([])), 0)
})

test('durationSeconds reflects the sample rate', () => {
  assert.equal(durationSeconds(TARGET_SAMPLE_RATE, TARGET_SAMPLE_RATE), 1)
  assert.equal(durationSeconds(0, TARGET_SAMPLE_RATE), 0)
  assert.equal(durationSeconds(10, 0), 0)
})
