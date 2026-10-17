/**
 * Mechanical check of a folder of recorded WAVs against the expected list.
 *
 * Catches the mistakes a human ear skating over 89 clips misses: a clip never
 * recorded, a wrong file name, wrong sample rate, a dead microphone (silence),
 * clipping, and a clip so short or long the sentence was cut off or duplicated.
 *
 * It cannot judge whether the right word was spoken — that is asr-verify.py.
 *
 * Run:  node src/check-recordings.mjs [--dir work/audio] [--list work/manifest.json]
 * Exit: 0 when there are no errors (warnings allowed), 1 when there are errors.
 */
import { readFileSync, writeFileSync, readdirSync, existsSync, mkdirSync } from 'node:fs'
import { join, isAbsolute, relative } from 'node:path'
import { ROOT, AUDIO_DIR, MANIFEST_PATH, RECORDING_WORKLIST, REPORTS_DIR } from './paths.mjs'

function arg(flag, fallback) {
  const i = process.argv.indexOf(flag)
  return i !== -1 && process.argv[i + 1] ? process.argv[i + 1] : fallback
}

const resolve = (p) => (isAbsolute(p) ? p : join(ROOT, p))
const rel = (p) => relative(ROOT, p).replace(/\\/g, '/')

const dir = resolve(arg('--dir', AUDIO_DIR))
const defaultList = existsSync(MANIFEST_PATH) ? MANIFEST_PATH : RECORDING_WORKLIST
const listPath = resolve(arg('--list', defaultList))

const EXPECT_RATE = 11025
const EXPECT_BITS = 16
const EXPECT_CHANNELS = 1
const SILENCE_DB = -50
const CLIP_LEVEL = 0.9995

if (!existsSync(listPath)) {
  console.error(`Expected list not found: ${listPath}`)
  process.exit(1)
}

const expected = JSON.parse(readFileSync(listPath, 'utf8'))

const dbfs = (amp) => (amp <= 0 ? -Infinity : 20 * Math.log10(Math.min(1, amp)))

function analyzeWav(buf) {
  if (buf.length < 44 || buf.toString('ascii', 0, 4) !== 'RIFF' || buf.toString('ascii', 8, 12) !== 'WAVE') {
    throw new Error('not a RIFF/WAVE file')
  }
  let offset = 12
  let fmt = null
  let data = null
  while (offset + 8 <= buf.length) {
    const id = buf.toString('ascii', offset, offset + 4)
    const size = buf.readUInt32LE(offset + 4)
    const body = offset + 8
    if (id === 'fmt ') {
      fmt = {
        audioFormat: buf.readUInt16LE(body),
        channels: buf.readUInt16LE(body + 2),
        sampleRate: buf.readUInt32LE(body + 4),
        bitsPerSample: buf.readUInt16LE(body + 14),
      }
    } else if (id === 'data') {
      data = buf.subarray(body, Math.min(body + size, buf.length))
    }
    offset = body + size + (size % 2)
  }
  if (!fmt || !data) throw new Error('missing fmt/data chunk')

  const { channels, sampleRate, bitsPerSample, audioFormat } = fmt
  const bytesPerSample = bitsPerSample / 8
  const frameBytes = bytesPerSample * channels
  const frames = Math.floor(data.length / frameBytes)
  if (frames === 0 || frameBytes === 0) throw new Error('empty audio data')

  const readSample = (pos) => {
    if (audioFormat === 3 && bitsPerSample === 32) return data.readFloatLE(pos)
    if (bitsPerSample === 16) return data.readInt16LE(pos) / 32768
    if (bitsPerSample === 24) {
      const v = (data[pos] | (data[pos + 1] << 8) | (data[pos + 2] << 16)) << 8
      return v / 2147483648
    }
    if (bitsPerSample === 32) return data.readInt32LE(pos) / 2147483648
    throw new Error(`unsupported PCM ${bitsPerSample}-bit`)
  }

  let peak = 0
  let sumSquares = 0
  let clipped = 0
  const frameRms = []
  for (let f = 0; f < frames; f++) {
    let frameSum = 0
    for (let c = 0; c < channels; c++) {
      const s = Math.abs(readSample(f * frameBytes + c * bytesPerSample))
      if (s > peak) peak = s
      if (s > CLIP_LEVEL) clipped += 1
      sumSquares += s * s
      frameSum += s * s
    }
    frameRms.push(Math.sqrt(frameSum / channels))
  }
  const rms = Math.sqrt(sumSquares / (frames * channels))
  const duration = frames / sampleRate

  const framesPerWindow = Math.max(1, Math.round(sampleRate * 0.02))
  const silentThreshold = 10 ** (SILENCE_DB / 20)
  const windows = []
  for (let i = 0; i < frameRms.length; i += framesPerWindow) {
    const slice = frameRms.slice(i, i + framesPerWindow)
    windows.push(Math.sqrt(slice.reduce((a, b) => a + b * b, 0) / slice.length))
  }
  const isQuiet = (w) => w < silentThreshold
  let start = 0
  while (start < windows.length && isQuiet(windows[start])) start++
  let end = windows.length - 1
  while (end >= 0 && isQuiet(windows[end])) end--

  return {
    ...fmt,
    duration,
    peakDb: dbfs(peak),
    rmsDb: dbfs(rms),
    clippedRatio: clipped / (frames * channels),
    leadingSilence: (start * framesPerWindow) / sampleRate,
    trailingSilence: (Math.max(0, windows.length - 1 - end) * framesPerWindow) / sampleRate,
  }
}

const wordsIn = (text) => (String(text || '').match(/[A-Za-z\u2019']+/g) || []).length

const errors = []
const warnings = []
const oks = []
const listed = new Set()

for (const item of expected) {
  const file = item.file || `${item.id}.wav`
  listed.add(file)
  const path = join(dir, file)

  if (!existsSync(path)) {
    errors.push({ file, kind: 'missing', detail: '文件不存在（漏录或命名不一致）' })
    continue
  }

  let info
  try {
    info = analyzeWav(readFileSync(path))
  } catch (e) {
    errors.push({ file, kind: 'unreadable', detail: e.message })
    continue
  }

  const words = wordsIn(item.text)
  const lower = Math.max(0.5, words / 4.5)
  const upper = words / 1.1 + 3.5
  const issues = []

  if (info.channels !== EXPECT_CHANNELS) issues.push(['error', `声道=${info.channels}（应为 ${EXPECT_CHANNELS}）`])
  if (info.sampleRate !== EXPECT_RATE) issues.push(['error', `采样率=${info.sampleRate}（应为 ${EXPECT_RATE}）`])
  if (info.bitsPerSample !== EXPECT_BITS) issues.push(['error', `位深=${info.bitsPerSample}（应为 ${EXPECT_BITS}）`])
  if (info.peakDb < -40) issues.push(['error', `几乎静音 peak=${info.peakDb.toFixed(1)}dBFS（麦克风没开？）`])
  else if (info.peakDb < -20) issues.push(['warn', `音量偏小 peak=${info.peakDb.toFixed(1)}dBFS`])
  if (info.clippedRatio > 0.01) issues.push(['error', `削波 ${(info.clippedRatio * 100).toFixed(2)}%（录爆了）`])
  else if (info.clippedRatio > 0.001) issues.push(['warn', `轻微削波 ${(info.clippedRatio * 100).toFixed(2)}%`])
  if (info.duration < lower * 0.6) issues.push(['error', `过短 ${info.duration.toFixed(2)}s（按 ${words} 词应≥${lower.toFixed(1)}s，可能被截断）`])
  else if (info.duration < lower) issues.push(['warn', `偏短 ${info.duration.toFixed(2)}s（${words} 词）`])
  if (info.duration > upper * 2) issues.push(['error', `过长 ${info.duration.toFixed(2)}s（${words} 词，可能重复或长静音）`])
  else if (info.duration > upper) issues.push(['warn', `偏长 ${info.duration.toFixed(2)}s（${words} 词）`])
  if (info.leadingSilence > 2) issues.push(['warn', `开头静音 ${info.leadingSilence.toFixed(1)}s`])
  if (info.trailingSilence > 2) issues.push(['warn', `结尾静音 ${info.trailingSilence.toFixed(1)}s`])

  const errs = issues.filter(([k]) => k === 'error')
  const warns = issues.filter(([k]) => k === 'warn')
  if (errs.length) errors.push({ file, kind: 'audio', detail: errs.map(([, d]) => d).join('；') })
  else if (warns.length) warnings.push({ file, kind: 'audio', detail: warns.map(([, d]) => d).join('；') })
  else oks.push({ file, duration: info.duration, peakDb: info.peakDb })
}

if (existsSync(dir)) {
  for (const f of readdirSync(dir)) {
    if (f.toLowerCase().endsWith('.wav') && !listed.has(f)) {
      warnings.push({ file: f, kind: 'extra', detail: '不在清单里的 WAV（多余文件）' })
    }
  }
}

mkdirSync(REPORTS_DIR, { recursive: true })
const reportPath = join(REPORTS_DIR, 'recording-set-check.md')
const lines = []
lines.push('# 录音集校验报告（机械，自动生成）')
lines.push('')
lines.push('> 由 `node src/check-recordings.mjs` 生成。')
lines.push(`> 清单：${rel(listPath)}；目录：${rel(dir)}`)
lines.push(`> 生成时间（本地）：${new Date().toISOString()}`)
lines.push('')
lines.push(`- 通过：${oks.length}`)
lines.push(`- 警告：${warnings.length}`)
lines.push(`- 错误：${errors.length}`)
lines.push('')
lines.push('## 错误（必须修）')
lines.push('')
if (!errors.length) lines.push('无。')
else {
  lines.push('| 文件 | 类型 | 说明 |')
  lines.push('|---|---|---|')
  for (const e of errors) lines.push(`| ${e.file} | ${e.kind} | ${e.detail} |`)
}
lines.push('')
lines.push('## 警告（人工确认）')
lines.push('')
if (!warnings.length) lines.push('无。')
else {
  lines.push('| 文件 | 类型 | 说明 |')
  lines.push('|---|---|---|')
  for (const w of warnings) lines.push(`| ${w.file} | ${w.kind} | ${w.detail} |`)
}
lines.push('')
lines.push('> 本报告只做机械检查。内容正确性（念错/漏词/录错行）见 `npm run verify-asr`。')
lines.push('')
writeFileSync(reportPath, lines.join('\n'), 'utf8')

console.log(`Checked ${expected.length} expected clips in ${rel(dir)}`)
console.log(`  ok: ${oks.length}, warnings: ${warnings.length}, errors: ${errors.length}`)
for (const e of errors.slice(0, 40)) console.log(`  ERROR ${e.file}: ${e.detail}`)
if (errors.length > 40) console.log(`  ... and ${errors.length - 40} more errors`)
for (const w of warnings.slice(0, 20)) console.log(`  warn  ${w.file}: ${w.detail}`)
console.log(`Report: ${rel(reportPath)}`)

process.exit(errors.length ? 1 : 0)
