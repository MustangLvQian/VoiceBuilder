// Turn whatever the browser's MediaRecorder produced into the exact WAV the App
// expects: 11 kHz, 16-bit, mono. No server round-trip and no ffmpeg needed — the
// browser already has a decoder and a resampler, we just call them.
//
// This file is deliberately dependency-free and side-effect-free so it can be
// unit-tested in Node (see test/audio-format.test.js).

export const TARGET_SAMPLE_RATE = 11025

// Float32 [-1, 1] -> Int16 little-endian samples, clamped rather than wrapped.
export function floatToInt16(input) {
  const out = new Int16Array(input.length)
  for (let i = 0; i < input.length; i++) {
    let sample = input[i]
    if (Number.isNaN(sample)) sample = 0
    // Clamp so 1.4 or Infinity become full-scale instead of wrapping to negative.
    if (sample > 1) sample = 1
    else if (sample < -1) sample = -1
    // Round, not truncate: truncation would bias every sample toward zero.
    out[i] = Math.round(sample < 0 ? sample * 0x8000 : sample * 0x7fff)
  }
  return out
}

// Average every channel into one, so a stereo mic does not land as a stereo file.
export function downmix(channels) {
  if (channels.length === 1) return channels[0]
  const length = channels[0].length
  const mixed = new Float32Array(length)
  for (const channel of channels) {
    for (let i = 0; i < length; i++) mixed[i] += channel[i] / channels.length
  }
  return mixed
}

// 16-bit mono PCM WAV, hand-assembled (44-byte canonical header).
export function encodeWav(samples, sampleRate) {
  const dataBytes = samples.length * 2
  const buffer = new ArrayBuffer(44 + dataBytes)
  const view = new DataView(buffer)
  const ascii = (offset, text) => {
    for (let i = 0; i < text.length; i++) view.setUint8(offset + i, text.charCodeAt(i))
  }
  ascii(0, 'RIFF')
  view.setUint32(4, 36 + dataBytes, true)
  ascii(8, 'WAVE')
  ascii(12, 'fmt ')
  view.setUint32(16, 16, true)          // PCM chunk size
  view.setUint16(20, 1, true)           // format = PCM
  view.setUint16(22, 1, true)           // channels = mono
  view.setUint32(24, sampleRate, true)
  view.setUint32(28, sampleRate * 2, true)   // byte rate
  view.setUint16(32, 2, true)           // block align
  view.setUint16(34, 16, true)          // bits per sample
  ascii(36, 'data')
  view.setUint32(40, dataBytes, true)
  for (let i = 0; i < samples.length; i++) view.setInt16(44 + i * 2, samples[i], true)
  return buffer
}

// Peak absolute amplitude, 0..1 - used to warn about a silent take before saving.
export function peakAmplitude(samples) {
  let peak = 0
  for (let i = 0; i < samples.length; i++) {
    const value = Math.abs(samples[i])
    if (value > peak) peak = value
  }
  return peak
}

// A readable duration for the UI.
export function durationSeconds(sampleCount, sampleRate) {
  return sampleRate > 0 ? sampleCount / sampleRate : 0
}
