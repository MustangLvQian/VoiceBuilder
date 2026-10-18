// Browser-side recording. Wraps getUserMedia + MediaRecorder, then decodes and
// resamples the take to the App's 11 kHz / 16-bit / mono WAV in one pass.
//
// The browser does the hard part: decodeAudioData reads whatever container
// MediaRecorder chose (webm/opus in Chrome, mp4/aac in Safari), and
// OfflineAudioContext resamples it. That is why this needs no ffmpeg.
import { floatToInt16, downmix, encodeWav, peakAmplitude, durationSeconds, TARGET_SAMPLE_RATE } from './audio-format.js'

let sharedContext = null

// One AudioContext for decoding; created lazily because browsers block it until
// the first user gesture anyway.
export function audioContext() {
  if (!sharedContext) {
    const Ctor = window.AudioContext || window.webkitAudioContext
    sharedContext = new Ctor()
  }
  if (sharedContext.state === 'suspended') sharedContext.resume()
  return sharedContext
}

export async function listMicrophones() {
  if (!navigator.mediaDevices || !navigator.mediaDevices.enumerateDevices) return []
  const devices = await navigator.mediaDevices.enumerateDevices()
  return devices
    .filter((d) => d.kind === 'audioinput')
    .map((d, i) => ({ deviceId: d.deviceId, label: d.label || `麦克风 ${i + 1}` }))
}

// Decode any audio the browser understands and hand back a normalised WAV.
export async function toNormalizedWav(arrayBuffer, targetRate = TARGET_SAMPLE_RATE) {
  const ctx = audioContext()
  const decoded = await ctx.decodeAudioData(arrayBuffer.slice(0))
  const channels = []
  for (let c = 0; c < decoded.numberOfChannels; c++) channels.push(decoded.getChannelData(c))
  const mono = downmix(channels)

  let resampled = mono
  if (decoded.sampleRate !== targetRate) {
    const length = Math.max(1, Math.round(decoded.length * targetRate / decoded.sampleRate))
    const offline = new OfflineAudioContext(1, length, targetRate)
    const buffer = offline.createBuffer(1, mono.length, decoded.sampleRate)
    buffer.copyToChannel(mono, 0)
    const source = offline.createBufferSource()
    source.buffer = buffer
    source.connect(offline.destination)
    source.start()
    const rendered = await offline.startRendering()
    resampled = rendered.getChannelData(0)
  }

  const pcm = floatToInt16(resampled)
  return {
    wav: encodeWav(pcm, targetRate),
    sampleRate: targetRate,
    duration: durationSeconds(pcm.length, targetRate),
    peak: peakAmplitude(resampled),
  }
}

function pickMimeType() {
  const options = ['audio/webm;codecs=opus', 'audio/webm', 'audio/ogg;codecs=opus', 'audio/mp4', '']
  for (const type of options) {
    if (type === '') return ''
    if (window.MediaRecorder && MediaRecorder.isTypeSupported(type)) return type
  }
  return ''
}

export class Recorder {
  constructor({ deviceId = '' } = {}) {
    this.deviceId = deviceId
    this.stream = null
    this.mediaRecorder = null
    this.chunks = []
  }

  get recording() {
    return Boolean(this.mediaRecorder && this.mediaRecorder.state === 'recording')
  }

  async start() {
    const constraints = { audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } }
    if (this.deviceId) constraints.audio.deviceId = { exact: this.deviceId }
    this.stream = await navigator.mediaDevices.getUserMedia(constraints)
    this.chunks = []
    const mimeType = pickMimeType()
    this.mediaRecorder = new MediaRecorder(this.stream, mimeType ? { mimeType } : undefined)
    this.mediaRecorder.ondataavailable = (event) => { if (event.data && event.data.size) this.chunks.push(event.data) }
    this.mediaRecorder.start()
    this.startedAt = performance.now()
  }

  // Stops the take, releases the mic, and returns the normalised WAV.
  async stop(targetRate = TARGET_SAMPLE_RATE) {
    if (!this.mediaRecorder) throw new Error('还没有在录音')
    const recorder = this.mediaRecorder
    const blob = await new Promise((resolve) => {
      recorder.onstop = () => resolve(new Blob(this.chunks, { type: recorder.mimeType || 'audio/webm' }))
      recorder.stop()
    })
    this.release()
    const arrayBuffer = await blob.arrayBuffer()
    const result = await toNormalizedWav(arrayBuffer, targetRate)
    return { ...result, elapsedMs: performance.now() - this.startedAt }
  }

  cancel() {
    if (this.mediaRecorder && this.mediaRecorder.state !== 'inactive') this.mediaRecorder.stop()
    this.release()
  }

  release() {
    if (this.stream) {
      for (const track of this.stream.getTracks()) track.stop()
      this.stream = null
    }
    this.mediaRecorder = null
  }
}
